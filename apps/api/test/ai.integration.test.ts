// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты AI-бэкенда (ТЗ §3.9) против реального PostgreSQL в схеме
// puls_test: хранение ключей зашифрованными, приоритет личного ключа над общим,
// учёт токенов, месячный лимит, админ-настройки и классификация ошибок.
// Реальные вызовы провайдеров запрещены — HTTP-клиент AI_HTTP подменён фейком.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { estimateAiCostUsd } from '@puls/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AI_HTTP, type AiHttpClient, type AiHttpRequest } from '../src/ai/ai-http';
import { AiKeyService } from '../src/ai/ai-key.service';
import { AiProviderService } from '../src/ai/ai-provider.service';
import { TestClient } from './client';

const PASSWORD = 'Secret12345';
const USER_KEY = 'sk-user-1234567890abcdef';

interface MockResponse {
  status: number;
  body: unknown;
}

describe('AI-бэкенд (ТЗ §3.9, интеграция с PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;
  let ai: AiProviderService;
  let keys: AiKeyService;

  const calls: AiHttpRequest[] = [];
  let responder: (req: AiHttpRequest) => MockResponse;

  const fakeHttp: AiHttpClient = {
    async post(req) {
      calls.push(req);
      const response = responder(req);
      return {
        status: response.status,
        ok: response.status < 400,
        json: async () => response.body,
        text: async () => JSON.stringify(response.body),
      };
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_HTTP)
      .useValue(fakeHttp)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
    ai = app.get(AiProviderService);
    keys = app.get(AiKeyService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    calls.length = 0;
    responder = () => ({
      status: 200,
      body: {
        choices: [{ message: { content: 'ок' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
    });
    for (const statement of [
      'DELETE FROM "ai_usage"',
      'DELETE FROM "user_ai_keys"',
      `UPDATE "instance_settings" SET ai_provider=NULL, ai_api_key_encrypted=NULL, ai_api_key_last4=NULL, ai_base_url=NULL, ai_model=NULL, ai_monthly_token_limit=NULL`,
      'DELETE FROM "sessions"',
      'DELETE FROM "email_verification_tokens"',
      'DELETE FROM "users"',
    ]) {
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch {
        // FK соседних фикстур параллельных агентов — пропускаем.
      }
    }
    mail.clearOutbox();
  });

  async function signUp(
    email: string,
    nickname: string,
  ): Promise<{ client: TestClient; userId: string }> {
    const client = new TestClient(server);
    await client.csrf();
    const registered = await client.post('/api/auth/register', {
      email,
      password: PASSWORD,
      nickname,
    });
    expect(registered.status).toBe(201);
    const token = mail.lastVerificationTokenFor(email);
    expect(token).toBeTruthy();
    const verified = await client.post('/api/auth/verify-email', { token });
    expect(verified.status).toBe(200);
    return { client, userId: verified.body.user.id as string };
  }

  async function makeAdmin(userId: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { role: 'admin' } });
  }

  describe('Состояние AI (ТЗ §3.9)', () => {
    it('без ключей AI выключен, расход нулевой', async () => {
      const { client } = await signUp('ai-off@example.com', 'aioff');
      const response = await client.get('/api/ai/status');
      expect(response.status).toBe(200);
      expect(response.body.status).toMatchObject({
        enabled: false,
        source: 'none',
        provider: null,
        last4: null,
        usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, limitTokens: null },
      });
    });

    it('личный ключ шифруется в БД и наружу уходит только last4', async () => {
      const { client, userId } = await signUp('ai-key@example.com', 'aikey');
      const saved = await client.put('/api/ai/key', { provider: 'anthropic', apiKey: USER_KEY });
      expect(saved.status).toBe(200);
      expect(saved.body.status).toMatchObject({
        enabled: true,
        source: 'user',
        provider: 'anthropic',
        last4: 'cdef',
      });
      expect(saved.body.status.model).toBeTruthy();
      expect(JSON.stringify(saved.body)).not.toContain(USER_KEY);

      const row = await prisma.userAiKey.findUnique({ where: { userId } });
      expect(row).toBeTruthy();
      expect(row!.apiKeyEncrypted).not.toContain(USER_KEY);
      expect(row!.apiKeyEncrypted.startsWith('v1.')).toBe(true);
      expect(await keys.resolve(userId)).toMatchObject({ source: 'user', provider: 'anthropic' });
    });

    it('удаление личного ключа возвращает к общему', async () => {
      const { client, userId } = await signUp('ai-del@example.com', 'aidel');
      await client.put('/api/ai/key', { provider: 'openai', apiKey: USER_KEY });
      expect((await client.get('/api/ai/status')).body.status.source).toBe('user');

      // Общий ключ экземпляра (задаём напрямую, чтобы не зависеть от админ-эндпоинта).
      await keys.setInstanceSettings({
        provider: 'openai',
        apiKey: 'sk-instance-abcdefgh',
        model: 'gpt-4o-mini',
      });

      const afterDelete = await client.del('/api/ai/key');
      expect(afterDelete.status).toBe(204);
      const statusAfter = await client.get('/api/ai/status');
      expect(statusAfter.body.status).toMatchObject({
        enabled: true,
        source: 'instance',
        provider: 'openai',
        last4: null,
      });
      expect(userId).toBeTruthy();
    });

    it('openai_compatible принимает пустой ключ с адресом сервера', async () => {
      const { client } = await signUp('ai-local@example.com', 'ailocal');
      const response = await client.put('/api/ai/key', {
        provider: 'openai_compatible',
        apiKey: '',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.1',
      });
      expect(response.status).toBe(200);
      expect(response.body.status).toMatchObject({
        provider: 'openai_compatible',
        baseUrl: 'http://localhost:11434/v1',
        last4: null,
      });
    });

    it('короткий ключ отклоняется (400)', async () => {
      const { client } = await signUp('ai-bad@example.com', 'aibad');
      const response = await client.put('/api/ai/key', { provider: 'openai', apiKey: 'short' });
      expect(response.status).toBe(400);
    });
  });

  describe('Запрос к провайдеру и учёт токенов', () => {
    it('complete вызывает адаптер и накапливает расход за месяц', async () => {
      const { userId } = await signUp('ai-use@example.com', 'aiuse');
      await keys.setUserKey(userId, { provider: 'openai', apiKey: USER_KEY });
      responder = () => ({
        status: 200,
        body: {
          choices: [{ message: { content: 'Привет' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        },
      });

      const result = await ai.complete(userId, {
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(result).toEqual({ text: 'Привет', toolCalls: [], tokensIn: 100, tokensOut: 50 });
      expect(calls[0].url).toContain('openai.com');

      const usage = await keys.usage(userId);
      expect(usage.tokensIn).toBe(100);
      expect(usage.tokensOut).toBe(50);
      expect(usage.costUsd).toBe(estimateAiCostUsd('openai', 100, 50));

      const second = await ai.complete(userId, {
        system: 's',
        messages: [{ role: 'user', content: 'again' }],
      });
      expect(second.tokensIn).toBe(100);
      const accumulated = await keys.usage(userId);
      expect(accumulated.tokensIn).toBe(200);
      expect(accumulated.tokensOut).toBe(100);
    });

    it('без ключа complete бросает ai_not_configured', async () => {
      const { userId } = await signUp('ai-none@example.com', 'ainone');
      await expect(
        ai.complete(userId, { system: 's', messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toMatchObject({ response: { code: 'ai_not_configured' } });
    });

    it('месячный лимит общего ключа блокирует запрос с ai_limit_reached', async () => {
      const { userId } = await signUp('ai-limit@example.com', 'ailimit');
      await keys.setInstanceSettings({
        provider: 'openai',
        apiKey: 'sk-instance-abcdefgh',
        model: 'gpt-4o-mini',
        monthlyTokenLimit: 10,
      });
      responder = () => ({
        status: 200,
        body: {
          choices: [{ message: { content: 'ок' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        },
      });

      await ai.complete(userId, { system: 's', messages: [{ role: 'user', content: 'first' }] });
      await expect(
        ai.complete(userId, { system: 's', messages: [{ role: 'user', content: 'second' }] }),
      ).rejects.toMatchObject({ response: { code: 'ai_limit_reached' } });
      // Второй вызов не дошёл до провайдера.
      expect(calls).toHaveLength(1);
    });

    it('ошибка провайдера → ai_provider_error (502) без деталей', async () => {
      const { userId } = await signUp('ai-err@example.com', 'aierr');
      await keys.setUserKey(userId, { provider: 'openai', apiKey: USER_KEY });
      responder = () => ({ status: 500, body: { error: 'internal secret details' } });

      const error = await ai
        .complete(userId, { system: 's', messages: [{ role: 'user', content: 'hi' }] })
        .then(
          () => null,
          (e: unknown) => e as { getStatus?(): number; response?: { code?: string } },
        );
      expect(error?.getStatus?.()).toBe(502);
      expect(error?.response?.code).toBe('ai_provider_error');
      expect(JSON.stringify(error?.response ?? {})).not.toContain('secret details');
    });
  });

  describe('«Проверить подключение»', () => {
    it('ok=true при рабочем ключе', async () => {
      const { client } = await signUp('ai-test-ok@example.com', 'aitestok');
      await client.put('/api/ai/key', { provider: 'openai', apiKey: USER_KEY });
      const response = await client.post('/api/ai/key/test');
      expect(response.status).toBe(201);
      expect(response.body).toEqual({ ok: true });
    });

    it('ok=false с кодом invalid_key при 401', async () => {
      const { client } = await signUp('ai-test-401@example.com', 'aitest401');
      await client.put('/api/ai/key', { provider: 'openai', apiKey: USER_KEY });
      responder = () => ({ status: 401, body: { error: 'unauthorized' } });
      const response = await client.post('/api/ai/key/test');
      expect(response.status).toBe(201);
      expect(response.body).toEqual({ ok: false, error: 'invalid_key' });
    });
  });

  describe('Админ-настройки AI (ТЗ §2, §3.9)', () => {
    it('обычному пользователю админка запрещена (403)', async () => {
      const { client } = await signUp('ai-user@example.com', 'aiuser');
      expect((await client.get('/api/admin/ai/settings')).status).toBe(403);
      expect((await client.put('/api/admin/ai/settings', { provider: 'openai' })).status).toBe(403);
    });

    it('админ сохраняет общий ключ, лимит и видит только last4', async () => {
      const { client, userId } = await signUp('ai-admin@example.com', 'aiadmin');
      await makeAdmin(userId);

      const saved = await client.put('/api/admin/ai/settings', {
        provider: 'anthropic',
        apiKey: 'sk-ant-instance-9876543210',
        model: 'claude-3-5-sonnet-latest',
        monthlyTokenLimit: 500000,
      });
      expect(saved.status).toBe(200);
      expect(saved.body.settings).toMatchObject({
        provider: 'anthropic',
        last4: '3210',
        model: 'claude-3-5-sonnet-latest',
        monthlyTokenLimit: 500000,
      });
      expect(JSON.stringify(saved.body)).not.toContain('9876543210');

      // Пустое поле не перетирает прежние значения.
      const patched = await client.put('/api/admin/ai/settings', { monthlyTokenLimit: 1000 });
      expect(patched.body.settings).toMatchObject({
        provider: 'anthropic',
        last4: '3210',
        monthlyTokenLimit: 1000,
      });

      const fetched = await client.get('/api/admin/ai/settings');
      expect(fetched.body.settings).toMatchObject({
        provider: 'anthropic',
        monthlyTokenLimit: 1000,
      });

      // Пользователь без личного ключа теперь работает через общий.
      const other = await signUp('ai-instance-user@example.com', 'aiinstanceuser');
      expect((await other.client.get('/api/ai/status')).body.status).toMatchObject({
        enabled: true,
        source: 'instance',
        provider: 'anthropic',
        last4: null,
        usage: { limitTokens: 1000 },
      });
    });

    it('админ видит расход по пользователям за месяц', async () => {
      const { client, userId } = await signUp('ai-admin2@example.com', 'aiadmin2');
      await makeAdmin(userId);

      const worker = await signUp('ai-worker@example.com', 'aiworker');
      await keys.setUserKey(worker.userId, { provider: 'openai', apiKey: USER_KEY });
      responder = () => ({
        status: 200,
        body: {
          choices: [{ message: { content: 'ок' } }],
          usage: { prompt_tokens: 300, completion_tokens: 40 },
        },
      });
      await ai.complete(worker.userId, {
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
      });

      const month = new Date().toISOString().slice(0, 7);
      const response = await client.get(`/api/admin/ai/usage?month=${month}`);
      expect(response.status).toBe(200);
      expect(response.body.month).toBe(month);
      const row = (response.body.rows as Array<Record<string, unknown>>).find(
        (r) => r.userId === worker.userId,
      );
      expect(row).toMatchObject({ nickname: 'aiworker', tokensIn: 300, tokensOut: 40 });

      expect((await client.get('/api/admin/ai/usage?month=2026-13')).status).toBe(400);
    });
  });
});
