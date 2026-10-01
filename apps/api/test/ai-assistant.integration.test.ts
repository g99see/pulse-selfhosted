// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты AI-помощника (ТЗ §3.9) против реального PostgreSQL в
// схеме puls_test: цикл function calling, предложения «Применить», предпросмотр
// разбора без заметок/имени, изоляция пользователей, блок поддержки и ответ
// 409 ai_not_configured без ключа. Провайдер подменён фейком — сеть не нужна.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { AI_SYSTEM_PROMPT } from '@puls/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { AiCompletionRequest, AiCompletionResult } from '../src/ai/ai.types';
import { AiKeyService } from '../src/ai/ai-key.service';
import { AiProviderService } from '../src/ai/ai-provider.service';
import { FetchAiHttpClient } from '../src/ai/ai-http';
import { MailService } from '../src/auth/mail.service';
import { SessionService } from '../src/auth/session.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestClient } from './client';

/** Фейковый провайдер: выдаёт заранее заданные ответы и записывает вызовы. */
class FakeAiProvider {
  queue: AiCompletionResult[] = [];
  calls: { userId: string; request: AiCompletionRequest }[] = [];
  /** Когда true — делегирует реальному сервису (проверка «нет ключа» → 409). */
  passthrough = false;
  real: AiProviderService | null = null;

  async complete(userId: string, request: AiCompletionRequest): Promise<AiCompletionResult> {
    this.calls.push({ userId, request });
    if (this.passthrough && this.real) return this.real.complete(userId, request);
    const next = this.queue.shift();
    if (!next) throw new Error('fake provider: сценарий исчерпан');
    return next;
  }

  reset(): void {
    this.queue = [];
    this.calls = [];
    this.passthrough = false;
  }

  push(result: AiCompletionResult): void {
    this.queue.push(result);
  }
}

const textResult = (text: string): AiCompletionResult => ({
  text,
  toolCalls: [],
  tokensIn: 10,
  tokensOut: 5,
});
const toolResult = (name: string, args: Record<string, unknown>): AiCompletionResult => ({
  text: '',
  toolCalls: [{ id: `call-${name}`, name, arguments: args }],
  tokensIn: 12,
  tokensOut: 4,
});

describe('AI assistant API (интеграция с PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;
  let sessions: SessionService;
  let provider: FakeAiProvider;

  beforeAll(async () => {
    provider = new FakeAiProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiProviderService)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
    sessions = app.get(SessionService);
    provider.real = new AiProviderService(app.get(AiKeyService), new FetchAiHttpClient());
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    provider.reset();
    const statements = [
      'DELETE FROM "ai_proposals"',
      'DELETE FROM "ai_usage"',
      'DELETE FROM "user_ai_keys"',
      'DELETE FROM "insights"',
      'DELETE FROM "notification_rules"',
      'DELETE FROM "budgets"',
      'DELETE FROM "goal_deposits"',
      'DELETE FROM "goals"',
      'DELETE FROM "transactions"',
      'DELETE FROM "categories" WHERE "user_id" IS NOT NULL',
      'DELETE FROM "accounts"',
      'DELETE FROM "sessions"',
      'DELETE FROM "email_verification_tokens"',
      'DELETE FROM "check_ins"',
      'DELETE FROM "users"',
      // Ключ экземпляра не должен утекать между тестами (ТЗ §3.9).
      `UPDATE "instance_settings" SET "ai_provider" = NULL, "ai_api_key_encrypted" = NULL,
        "ai_api_key_last4" = NULL, "ai_base_url" = NULL, "ai_model" = NULL,
        "ai_monthly_token_limit" = NULL`,
    ];
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }
    mail.clearOutbox();
  });

  async function signUp(
    email: string,
    nickname: string,
    timezone = 'Europe/Moscow',
  ): Promise<TestClient> {
    const user = await prisma.user.create({
      data: {
        email,
        nickname,
        timezone,
        emailVerifiedAt: new Date(),
        onboardingCompletedAt: new Date(),
      },
    });
    const { token } = await sessions.create(user.id, { userAgent: 'vitest' });
    const client = new TestClient(server);
    client.cookies['puls_session'] = token;
    await client.csrf();
    return client;
  }

  const userByEmail = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } });

  async function seedExpense(userId: string, amount: number, categoryId?: string): Promise<void> {
    const account = await prisma.account.create({
      data: { userId, name: 'Карта', type: 'card', balance: 0 },
    });
    const day = new Date().toISOString().slice(0, 10);
    await prisma.transaction.create({
      data: {
        userId,
        accountId: account.id,
        categoryId: categoryId ?? null,
        type: 'expense',
        amount,
        amountBase: amount,
        currency: 'RUB',
        rate: 1,
        date: new Date(`${day}T00:00:00.000Z`),
      },
    });
  }

  it('цикл function calling: модель вызывает инструмент, затем отвечает', async () => {
    const client = await signUp('ai-loop@example.com', 'loop');
    provider.push(toolResult('get_spending_summary', {}));
    provider.push(textResult('Вы пока ничего не тратили.'));

    const response = await client.post('/api/ai/chat', { message: 'Сколько я потратил?' });

    expect(response.status).toBe(200);
    expect(response.body.reply).toBe('Вы пока ничего не тратили.');
    expect(response.body.proposals).toEqual([]);
    expect(response.body.usage.month).toMatch(/^\d{4}-\d{2}$/);

    // Первый вызов — с системным промптом и инструментами.
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]!.request.system).toBe(AI_SYSTEM_PROMPT);
    expect(provider.calls[0]!.request.tools?.length).toBeGreaterThan(0);
    // Второй вызов содержит результат вызова инструмента для этой же сессии.
    const toolMessage = provider.calls[1]!.request.messages.find(
      (message) => message.role === 'tool',
    );
    expect(toolMessage?.toolCallId).toBe('call-get_spending_summary');
    expect(provider.calls[1]!.userId).toBe((await userByEmail('ai-loop@example.com')).id);
  });

  it('предложение сохраняется pending, применяется кнопкой и идемпотентно', async () => {
    const client = await signUp('ai-propose@example.com', 'proposer');
    const categories = (await client.get('/api/finance/categories')).body.categories as {
      id: string;
      kind: string;
    }[];
    const category = categories.find((item) => item.kind === 'expense')!;
    const month = new Date().toISOString().slice(0, 7);

    provider.push(toolResult('propose_budget', { categoryId: category.id, month, limit: 5000 }));
    provider.push(textResult('Могу поставить бюджет 5000 в месяц. Применить?'));

    const chat = await client.post('/api/ai/chat', { message: 'Поставь бюджет на еду' });
    expect(chat.status).toBe(200);
    expect(chat.body.proposals).toHaveLength(1);
    expect(chat.body.proposals[0]).toMatchObject({ kind: 'budget', status: 'pending' });
    const proposalId = chat.body.proposals[0].id as string;

    // До «Применить» бюджет не создан.
    expect(await prisma.budget.count()).toBe(0);

    const applied = await client.post(`/api/ai/proposals/${proposalId}/apply`);
    expect(applied.status).toBe(201);
    expect(applied.body.applied.kind).toBe('budget');
    expect(applied.body.proposal.status).toBe('applied');
    const budgetId = applied.body.applied.id as string;

    const budgets = await prisma.budget.findMany();
    expect(budgets).toHaveLength(1);
    expect(budgets[0]!.id).toBe(budgetId);

    // Повторное применение не дублирует бюджет.
    const again = await client.post(`/api/ai/proposals/${proposalId}/apply`);
    expect(again.status).toBe(201);
    expect(again.body.applied.id).toBe(budgetId);
    expect(await prisma.budget.count()).toBe(1);

    // Чужое предложение применить нельзя.
    const other = await signUp('ai-other@example.com', 'other');
    const forbidden = await other.post(`/api/ai/proposals/${proposalId}/apply`);
    expect(forbidden.status).toBe(404);
  });

  it('напоминание применяется как правило уведомлений', async () => {
    const client = await signUp('ai-reminder@example.com', 'reminderer');
    provider.push(
      toolResult('propose_reminder', { notificationType: 'budget', times: ['10:00', '20:00'] }),
    );
    provider.push(textResult('Предлагаю напоминание о бюджете.'));

    const chat = await client.post('/api/ai/chat', { message: 'Напомни про бюджет' });
    const proposalId = chat.body.proposals[0].id as string;

    const applied = await client.post(`/api/ai/proposals/${proposalId}/apply`);
    expect(applied.status).toBe(201);
    expect(applied.body.applied).toEqual({ kind: 'reminder', id: 'budget' });

    const rules = await prisma.notificationRule.findMany();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ type: 'budget', enabled: true });
  });

  it('предпросмотр разбора не отправляет заметки и имя без флагов', async () => {
    const client = await signUp('ai-preview@example.com', 'previewer');
    const user = await userByEmail('ai-preview@example.com');
    await prisma.checkIn.create({
      data: {
        userId: user.id,
        mood: 3,
        note: 'СЕКРЕТНАЯ_ЗАМЕТКА_XYZ',
        occurredAt: new Date(),
      },
    });

    const without = await client.post('/api/ai/review/preview', { period: 'week' });
    expect(without.status).toBe(200);
    expect(without.body.preview.includesNotes).toBe(false);
    expect(without.body.preview.includesName).toBe(false);
    expect(without.body.preview.payloadText).not.toContain('СЕКРЕТНАЯ_ЗАМЕТКА_XYZ');
    expect(without.body.preview.payloadText).not.toContain('previewer');
    // Ключа нет → провайдер не выбран, локальность ложна.
    expect(without.body.preview.provider).toBeNull();
    expect(without.body.preview.isLocal).toBe(false);

    const withFlags = await client.post('/api/ai/review/preview', {
      period: 'week',
      includeNotes: true,
      includeName: true,
    });
    expect(withFlags.body.preview.includesNotes).toBe(true);
    expect(withFlags.body.preview.includesName).toBe(true);
    expect(withFlags.body.preview.payloadText).toContain('СЕКРЕТНАЯ_ЗАМЕТКА_XYZ');
    expect(withFlags.body.preview.payloadText).toContain('previewer');
  });

  it('инструменты видят только данные текущего пользователя', async () => {
    const a = await signUp('ai-iso-a@example.com', 'iso-a');
    await signUp('ai-iso-b@example.com', 'iso-b');
    const userA = await userByEmail('ai-iso-a@example.com');
    const userB = await userByEmail('ai-iso-b@example.com');
    await seedExpense(userA.id, 1111);
    await seedExpense(userB.id, 9999);

    provider.push(toolResult('get_spending_summary', { userId: userB.id }));
    provider.push(textResult('Готово.'));

    const response = await a.post('/api/ai/chat', { message: 'Мои траты' });
    expect(response.status).toBe(200);

    const toolMessage = provider.calls[1]!.request.messages.find(
      (message) => message.role === 'tool',
    );
    expect(toolMessage?.content).toContain('1111');
    expect(toolMessage?.content).not.toContain('9999');
  });

  it('при тревожном сигнале в ответ добавляется блок поддержки', async () => {
    const client = await signUp('ai-support@example.com', 'supporter');
    const user = await userByEmail('ai-support@example.com');
    await prisma.insight.create({
      data: {
        userId: user.id,
        type: 'wellbeing_concern',
        textKey: 'insights.text.wellbeingConcern',
        params: {},
        source: 'rule',
      },
    });
    provider.push(textResult('Мне жаль, что вам тяжело.'));

    const response = await client.post('/api/ai/chat', { message: 'Мне очень плохо' });
    expect(response.status).toBe(200);
    expect(response.body.reply).toContain('Мне жаль');
    // Europe/Moscow → RU: телефон службы поддержки из shared/insights.
    expect(response.body.reply).toContain('8-800-100-49-94');
  });

  it('без ключа эндпоинты отвечают 409 ai_not_configured', async () => {
    const client = await signUp('ai-nokey@example.com', 'nokey');
    provider.passthrough = true;

    const chat = await client.post('/api/ai/chat', { message: 'привет' });
    expect(chat.status).toBe(409);
    expect(chat.body.code).toBe('ai_not_configured');

    const review = await client.post('/api/ai/review', { period: 'month' });
    expect(review.status).toBe(409);
    expect(review.body.code).toBe('ai_not_configured');
  });
});
