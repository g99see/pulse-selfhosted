// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты открытого API и вебхуков (ТЗ §4, P2) против реального
// PostgreSQL в схеме puls_test. Запуск:
//   pnpm --filter @puls/api exec vitest run test/api-access.integration.test.ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_TOKEN_PREFIX } from '@puls/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { WebhookDispatcher } from '../src/api-access/webhook-dispatcher';
import { verifyWebhookSignature } from '../src/api-access/webhook-signature';
import { TestClient } from './client';

// Доставка на локальный http-сервер — разрешаем приватные адреса только в тесте.
process.env.WEBHOOKS_ALLOW_PRIVATE = '1';

const PASSWORD = 'Secret12345';

interface CapturedRequest {
  event: string;
  signature: string;
  deliveryId: string;
  body: string;
}

/** Локальный http-сервер, принимающий вебхуки. */
class HookServer {
  private server?: Server;
  private readonly requests: CapturedRequest[] = [];
  status = 200;

  async start(): Promise<string> {
    this.requests.length = 0;
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => this.handle(req, res));
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return `http://127.0.0.1:${port}/hook`;
  }

  get captured(): CapturedRequest[] {
    return this.requests;
  }

  async waitForRequests(count: number, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.requests.length < count) {
      if (Date.now() > deadline) throw new Error(`Вебхук не пришёл: ${count} за ${timeoutMs} мс`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.close();
    await once(this.server, 'close').catch(() => undefined);
    this.server = undefined;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      this.requests.push({
        event: String(req.headers['x-puls-event'] ?? ''),
        signature: String(req.headers['x-puls-signature'] ?? ''),
        deliveryId: String(req.headers['x-puls-delivery'] ?? ''),
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.statusCode = this.status;
      res.end('ok');
    });
  }
}

interface ApiTokenResponse {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  token: string;
  revokedAt: string | null;
}

interface WebhookResponse {
  id: string;
  url: string;
  events: string[];
  secret: string;
}

interface DeliveryRow {
  id: string;
  status: string;
  attempts: number;
  lastError: string | null;
}

describe('Открытый API и вебхуки (интеграция с PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;
  let dispatcher: WebhookDispatcher;
  const hook = new HookServer();

  const getBearer = (path: string, token: string) =>
    request(server).get(path).set('Authorization', `Bearer ${token}`);
  const postBearer = (path: string, token: string, body: object) =>
    request(server).post(path).set('Authorization', `Bearer ${token}`).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
    dispatcher = app.get(WebhookDispatcher);
  });

  afterAll(async () => {
    await hook.stop();
    await app?.close();
  });

  beforeEach(async () => {
    const statements = [
      'DELETE FROM "webhook_deliveries"',
      'DELETE FROM "webhooks"',
      'DELETE FROM "api_tokens"',
      'DELETE FROM "transactions"',
      'DELETE FROM "accounts"',
      'DELETE FROM "check_ins"',
      'DELETE FROM "user_achievements"',
      'DELETE FROM "posts"',
      'DELETE FROM "sessions"',
      'DELETE FROM "email_verification_tokens"',
      'DELETE FROM "users"',
    ];
    for (const statement of statements) {
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch {
        // Соседние фикстуры параллельных агентов могут держать FK — пропускаем.
      }
    }
    mail.clearOutbox();
    hook.status = 200;
  });

  async function signUp(email: string, nickname: string): Promise<TestClient> {
    const client = new TestClient(server);
    await client.csrf();
    const registered = await client.post('/api/auth/register', { email, password: PASSWORD, nickname });
    expect(registered.status).toBe(201);
    const token = mail.lastVerificationTokenFor(email);
    expect(token).toBeTruthy();
    expect((await client.post('/api/auth/verify-email', { token })).status).toBe(200);
    return client;
  }

  async function createAccount(client: TestClient, name = 'API-счёт'): Promise<string> {
    const response = await client.post('/api/finance/accounts', { name, type: 'card', balance: 1000 });
    expect(response.status).toBe(201);
    return (response.body as { id: string }).id;
  }

  async function createToken(
    client: TestClient,
    name: string,
    scopes: string[],
    expiresAt?: string,
  ): Promise<ApiTokenResponse> {
    const response = await client.post('/api/api-tokens', { name, scopes, expiresAt });
    expect(response.status).toBe(201);
    return response.body as ApiTokenResponse;
  }

  /** Ждёт, пока журнал доставок покажет нужное состояние (гонка с фоновой доставкой). */
  async function waitForDelivery(
    client: TestClient,
    webhookId: string,
    predicate: (row: DeliveryRow) => boolean,
    timeoutMs = 5_000,
  ): Promise<DeliveryRow> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const response = await client.get(`/api/webhooks/${webhookId}/deliveries`);
      const row = (response.body.deliveries as DeliveryRow[])[0];
      if (row && predicate(row)) return row;
      if (Date.now() > deadline) throw new Error('Доставка не обновилась вовремя');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  describe('Личные токены и публичный API (ТЗ §4)', () => {
    it('read-токен читает /api/v1/me, но не пишет (403)', async () => {
      const client = await signUp('api-read@example.com', 'apiread');
      const token = await createToken(client, 'Чтение', ['read']);

      expect(token.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
      expect(token.prefix).toBe(token.token.slice(0, 12));

      const me = await getBearer('/api/v1/me', token.token);
      expect(me.status).toBe(200);
      expect(me.body.user.nickname).toBe('apiread');
      expect(me.body.scopes).toEqual(['read']);
      expect(me.body.user.passwordHash).toBeUndefined();

      expect((await getBearer('/api/v1/transactions', token.token)).status).toBe(200);
      expect((await getBearer('/api/v1/checkins', token.token)).status).toBe(200);
      expect((await getBearer('/api/v1/stats/day', token.token)).status).toBe(200);

      const accountId = await createAccount(client);
      const write = await postBearer('/api/v1/transactions', token.token, {
        accountId,
        type: 'expense',
        amount: 100,
      });
      expect(write.status).toBe(403);
      expect((write.body as { code: string }).code).toBe('insufficient_scope');
    });

    it('write-токен создаёт транзакцию через публичный API и читает', async () => {
      const client = await signUp('api-write@example.com', 'apiwrite');
      const accountId = await createAccount(client);
      const token = await createToken(client, 'Запись', ['write']);

      const created = await postBearer('/api/v1/transactions', token.token, {
        accountId,
        type: 'expense',
        amount: 250,
        comment: 'из Home Assistant',
      });
      expect(created.status).toBe(201);
      expect((created.body as { amount: number }).amount).toBe(250);

      // write включает чтение.
      expect((await getBearer('/api/v1/me', token.token)).status).toBe(200);
      const list = await client.get('/api/finance/transactions');
      expect(
        (list.body.transactions as Array<{ comment: string | null }>).some(
          (item) => item.comment === 'из Home Assistant',
        ),
      ).toBe(true);
    });

    it('отозванный и просроченный токен → 401', async () => {
      const client = await signUp('api-revoke@example.com', 'apirevoke');
      const token = await createToken(client, 'Отзыв', ['read']);
      expect((await getBearer('/api/v1/me', token.token)).status).toBe(200);

      expect((await client.del(`/api/api-tokens/${token.id}`)).status).toBe(204);
      expect((await getBearer('/api/v1/me', token.token)).status).toBe(401);
      expect((await client.get('/api/api-tokens')).body.tokens[0].revokedAt).toBeTruthy();

      const expired = await createToken(
        client,
        'Просрочен',
        ['read'],
        new Date(Date.now() - 60_000).toISOString(),
      );
      expect((await getBearer('/api/v1/me', expired.token)).status).toBe(401);
    });

    it('без токена и с мусорным токеном → 401', async () => {
      const anon = new TestClient(server);
      expect((await anon.get('/api/v1/me')).status).toBe(401);

      const bogus = await request(server).get('/api/v1/me').set('Authorization', 'Bearer puls_bogus');
      expect(bogus.status).toBe(401);
      const basic = await request(server).get('/api/v1/me').set('Authorization', 'Basic abc');
      expect(basic.status).toBe(401);
    });

    it('токен не даёт доступа к данным другого пользователя', async () => {
      const alice = await signUp('api-alice@example.com', 'apialice');
      const bob = await signUp('api-bob@example.com', 'apibob');
      const accountId = await createAccount(alice, 'Счёт Алисы');
      await alice.post('/api/finance/transactions', { accountId, type: 'expense', amount: 500 });

      const bobToken = await createToken(bob, 'Боба', ['read']);
      const list = await getBearer('/api/v1/transactions', bobToken.token);
      expect((list.body.transactions as unknown[])).toHaveLength(0);

      // Чужой токен нельзя отозвать.
      const aliceToken = await createToken(alice, 'Алисы', ['read']);
      expect((await bob.del(`/api/api-tokens/${aliceToken.id}`)).status).toBe(404);
      expect((await bob.get('/api/api-tokens')).body.tokens).toHaveLength(1);
    });

    it('секрет не раскрывается в списке токенов; без сессии — 401', async () => {
      const client = await signUp('api-list@example.com', 'apilist');
      const created = await createToken(client, 'Список', ['read', 'write']);
      const list = await client.get('/api/api-tokens');
      const row = list.body.tokens[0] as Record<string, unknown>;
      expect(row.prefix).toBe(created.prefix);
      expect(row.token).toBeUndefined();
      expect(row.tokenHash).toBeUndefined();

      const anon = new TestClient(server);
      expect((await anon.get('/api/api-tokens')).status).toBe(401);
      await anon.csrf();
      expect((await anon.post('/api/api-tokens', { name: 'x', scopes: ['read'] })).status).toBe(401);
    });
  });

  describe('Вебхуки (ТЗ §4)', () => {
    it('доставляет событие на локальный сервер с корректной подписью', async () => {
      const client = await signUp('wh-deliver@example.com', 'whdeliver');
      const accountId = await createAccount(client);
      const url = await hook.start();

      const created = await client.post('/api/webhooks', { url, events: ['transaction.created'] });
      expect(created.status).toBe(201);
      const webhook = created.body as WebhookResponse;
      expect(webhook.secret).toBeTruthy();

      await client.post('/api/finance/transactions', { accountId, type: 'expense', amount: 99 });
      await hook.waitForRequests(1);

      const received = hook.captured[0]!;
      expect(received.event).toBe('transaction.created');
      expect(verifyWebhookSignature(webhook.secret, received.body, received.signature)).toBe(true);
      const payload = JSON.parse(received.body) as {
        event: string;
        deliveryId: string;
        data: { amount: number };
      };
      expect(payload.event).toBe('transaction.created');
      expect(payload.data.amount).toBe(99);
      expect(received.deliveryId).toBe(payload.deliveryId);

      const row = await waitForDelivery(client, webhook.id, (item) => item.status === 'success');
      expect(row.attempts).toBe(1);

      await hook.stop();
    });

    it('повторяет доставку при 500 и доходит до успеха', async () => {
      const client = await signUp('wh-retry@example.com', 'whretry');
      const url = await hook.start();
      hook.status = 500;

      const created = await client.post('/api/webhooks', { url, events: ['checkin.created'] });
      const webhook = created.body as WebhookResponse;

      await client.post('/api/checkins', { mood: 4 });
      await hook.waitForRequests(1);

      let row = await waitForDelivery(client, webhook.id, (item) => item.attempts >= 1);
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(1);

      // Сервер «починился» — повторная попытка проходит.
      hook.status = 200;
      await dispatcher.attempt(row.id);

      row = await waitForDelivery(client, webhook.id, (item) => item.status === 'success');
      expect(row.attempts).toBe(2);

      await hook.stop();
    });

    it('после пяти неудачных попыток помечает доставку failed', async () => {
      const client = await signUp('wh-failed@example.com', 'whfailed');
      const url = await hook.start();
      hook.status = 503;

      const created = await client.post('/api/webhooks', { url, events: ['checkin.created'] });
      const webhook = created.body as WebhookResponse;
      await client.post('/api/checkins', { mood: 3 });
      await hook.waitForRequests(1);

      const stored = await waitForDelivery(client, webhook.id, (item) => item.attempts >= 1);

      // Первая попытка уже была; добираем до максимума (5).
      for (let i = 0; i < 4; i += 1) await dispatcher.attempt(stored.id);

      const final = await waitForDelivery(client, webhook.id, (item) => item.attempts >= 5);
      expect(final.attempts).toBe(5);
      expect(final.status).toBe('failed');
      expect(final.lastError).toContain('503');

      await hook.stop();
    });

    it('SSRF-отказ: приватный адрес и не-http(s) отклоняются', async () => {
      const client = await signUp('wh-ssrf@example.com', 'whssrf');

      const previous = process.env.WEBHOOKS_ALLOW_PRIVATE;
      delete process.env.WEBHOOKS_ALLOW_PRIVATE;
      try {
        const privateResponse = await client.post('/api/webhooks', {
          url: 'http://192.168.1.10/hook',
          events: ['checkin.created'],
        });
        expect(privateResponse.status).toBe(400);
        expect((privateResponse.body as { code: string }).code).toBe('webhook_url_private');

        const loopback = await client.post('/api/webhooks', {
          url: 'http://127.0.0.1:9/hook',
          events: ['checkin.created'],
        });
        expect(loopback.status).toBe(400);

        const badScheme = await client.post('/api/webhooks', {
          url: 'ftp://example.com/hook',
          events: ['checkin.created'],
        });
        expect(badScheme.status).toBe(400);
      } finally {
        process.env.WEBHOOKS_ALLOW_PRIVATE = previous ?? '1';
      }
    });

    it('список вебхуков не отдаёт секрет; чужой вебхук → 404', async () => {
      const alice = await signUp('wh-alice@example.com', 'whalice');
      const bob = await signUp('wh-bob@example.com', 'whbob');

      const created = await alice.post('/api/webhooks', {
        url: 'http://127.0.0.1:9/hook',
        events: ['goal.milestone'],
      });
      expect(created.status).toBe(201);
      const webhook = created.body as WebhookResponse;

      const list = await alice.get('/api/webhooks');
      const row = (list.body.webhooks as Array<Record<string, unknown>>)[0]!;
      expect(row.url).toBe('http://127.0.0.1:9/hook');
      expect(row.secret).toBeUndefined();
      expect(row.events).toEqual(['goal.milestone']);

      expect((await bob.get(`/api/webhooks/${webhook.id}/deliveries`)).status).toBe(404);
      expect((await bob.del(`/api/webhooks/${webhook.id}`)).status).toBe(404);
      expect((await bob.post(`/api/webhooks/${webhook.id}/test`)).status).toBe(404);
    });

    it('кнопка «Проверить» отправляет ping с подписью', async () => {
      const client = await signUp('wh-test@example.com', 'whtest');
      const url = await hook.start();
      const created = await client.post('/api/webhooks', { url, events: ['checkin.created'] });
      const webhook = created.body as WebhookResponse;

      const result = await client.post(`/api/webhooks/${webhook.id}/test`);
      expect(result.status).toBe(200);
      expect((result.body as { ok: boolean; status: number }).ok).toBe(true);
      expect((result.body as { status: number }).status).toBe(200);

      await hook.waitForRequests(1);
      const received = hook.captured[0]!;
      expect(received.event).toBe('ping');
      expect(verifyWebhookSignature(webhook.secret, received.body, received.signature)).toBe(true);

      await hook.stop();
    });

    it('без сессии вебхуки недоступны', async () => {
      const anon = new TestClient(server);
      expect((await anon.get('/api/webhooks')).status).toBe(401);
    });
  });
});
