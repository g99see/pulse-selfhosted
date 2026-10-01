// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты аутентификации (ТЗ §3.1, §6) против реального
// PostgreSQL в отдельной схеме puls_test. Запуск: pnpm --filter @puls/api test
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestClient } from './client';

const PASSWORD = 'Secret12345';

describe('Auth API (интеграция с PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "users", "sessions", "email_verification_tokens", "accounts", "check_ins" RESTART IDENTITY CASCADE',
    );
    mail.clearOutbox();
  });

  async function registerAndVerify(
    email: string,
    nickname: string,
  ): Promise<{ client: TestClient; userId: string }> {
    const client = new TestClient(server);
    await client.csrf();
    const registered = await client.post('/api/auth/register', { email, password: PASSWORD, nickname });
    expect(registered.status).toBe(201);

    const token = mail.lastVerificationTokenFor(email);
    expect(token).toBeTruthy();

    const verified = await client.post('/api/auth/verify-email', { token });
    expect(verified.status).toBe(200);
    return { client, userId: verified.body.user.id as string };
  }

  describe('CSRF (ТЗ §6)', () => {
    it('GET /api/auth/csrf выдаёт cookie и токен', async () => {
      const client = new TestClient(server);
      const token = await client.csrf();

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(client.cookies['puls_csrf']).toBe(token);
    });

    it('мутирующий запрос без CSRF-заголовка отклоняется', async () => {
      const response = await import('supertest').then(({ default: request }) =>
        request(server).post('/api/auth/register').send({ email: 'a@b.co', password: PASSWORD, nickname: 'abc' }),
      );

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('csrf_failed');
    });
  });

  describe('Регистрация (ТЗ §3.1)', () => {
    it('создаёт пользователя, нормализует email/никнейм и шлёт письмо', async () => {
      const client = new TestClient(server);
      await client.csrf();

      const response = await client.post('/api/auth/register', {
        email: '  User@Example.COM ',
        password: PASSWORD,
        nickname: 'Dmitro',
      });

      expect(response.status).toBe(201);
      expect(response.body.user).toMatchObject({ email: 'user@example.com', nickname: 'dmitro' });
      expect(response.body.user).not.toHaveProperty('passwordHash');
      expect(response.body.verificationSent).toBe(true);
      expect(mail.lastVerificationTokenFor('user@example.com')).toBeTruthy();

      const stored = await prisma.user.findUnique({ where: { email: 'user@example.com' } });
      expect(stored?.passwordHash?.startsWith('$argon2id$')).toBe(true);
      expect(stored?.emailVerifiedAt).toBeNull();
    });

    it('возвращает 409 email_taken на повторный email', async () => {
      const client = new TestClient(server);
      await client.csrf();
      await client.post('/api/auth/register', { email: 'dup@example.com', password: PASSWORD, nickname: 'first' });

      const response = await client.post('/api/auth/register', {
        email: 'dup@example.com',
        password: PASSWORD,
        nickname: 'second',
      });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('email_taken');
    });

    it('возвращает 409 nickname_taken на повторный никнейм', async () => {
      const client = new TestClient(server);
      await client.csrf();
      await client.post('/api/auth/register', { email: 'one@example.com', password: PASSWORD, nickname: 'same' });

      const response = await client.post('/api/auth/register', {
        email: 'two@example.com',
        password: PASSWORD,
        nickname: 'same',
      });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('nickname_taken');
    });

    it('возвращает 400 validation_error и не создаёт пользователя', async () => {
      const client = new TestClient(server);
      await client.csrf();

      const response = await client.post('/api/auth/register', {
        email: 'not-an-email',
        password: 'short',
        nickname: 'КИРИЛЛИЦА',
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('validation_error');
      expect(await prisma.user.count()).toBe(0);
    });
  });

  describe('Подтверждение email', () => {
    it('не даёт войти до подтверждения (403 email_not_verified)', async () => {
      const client = new TestClient(server);
      await client.csrf();
      await client.post('/api/auth/register', { email: 'noverify@example.com', password: PASSWORD, nickname: 'noverify' });

      const response = await client.post('/api/auth/login', { email: 'noverify@example.com', password: PASSWORD });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('email_not_verified');
    });

    it('подтверждает email, сразу логинит и помечает адрес', async () => {
      const client = new TestClient(server);
      await client.csrf();
      await client.post('/api/auth/register', { email: 'ok@example.com', password: PASSWORD, nickname: 'okuser' });

      const token = mail.lastVerificationTokenFor('ok@example.com') as string;
      const response = await client.post('/api/auth/verify-email', { token });

      expect(response.status).toBe(200);
      expect(response.body.user.emailVerified).toBe(true);
      expect(client.cookies['puls_session']).toBeTruthy();

      const stored = await prisma.user.findUnique({ where: { email: 'ok@example.com' } });
      expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('отклоняет повторно использованный токен (400 invalid_token)', async () => {
      const client = new TestClient(server);
      await client.csrf();
      await client.post('/api/auth/register', { email: 'once@example.com', password: PASSWORD, nickname: 'onceuser' });
      const token = mail.lastVerificationTokenFor('once@example.com') as string;

      expect((await client.post('/api/auth/verify-email', { token })).status).toBe(200);
      const second = await client.post('/api/auth/verify-email', { token });
      expect(second.status).toBe(400);
      expect(second.body.code).toBe('invalid_token');
    });

    it('resend выдаёт новый токен и инвалидирует старый', async () => {
      const client = new TestClient(server);
      await client.csrf();
      await client.post('/api/auth/register', { email: 'resend@example.com', password: PASSWORD, nickname: 'resenduser' });
      const oldToken = mail.lastVerificationTokenFor('resend@example.com') as string;

      const resent = await client.post('/api/auth/verify-email/resend', { email: 'resend@example.com' });
      expect(resent.status).toBe(202);
      const newToken = mail.lastVerificationTokenFor('resend@example.com') as string;
      expect(newToken).not.toBe(oldToken);

      const withOld = await client.post('/api/auth/verify-email', { token: oldToken });
      expect(withOld.status).toBe(400);

      expect((await client.post('/api/auth/verify-email', { token: newToken })).status).toBe(200);
    });
  });

  describe('Вход и сессии (ТЗ §6)', () => {
    it('успешный вход выдаёт cookie сессии и отдаёт /me', async () => {
      const { userId } = await registerAndVerify('login@example.com', 'loginuser');
      const client = new TestClient(server);
      await client.csrf();

      const response = await client.post('/api/auth/login', { email: 'login@example.com', password: PASSWORD });
      expect(response.status).toBe(200);
      expect(client.cookies['puls_session']).toBeTruthy();

      const me = await client.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.user).toMatchObject({ id: userId, email: 'login@example.com' });
      expect(me.body.onboardingCompleted).toBe(false);
      expect(me.body.user).not.toHaveProperty('passwordHash');
    });

    it('неверный пароль → 401 invalid_credentials', async () => {
      await registerAndVerify('wrong@example.com', 'wronguser');
      const client = new TestClient(server);
      await client.csrf();

      const response = await client.post('/api/auth/login', { email: 'wrong@example.com', password: 'Nope123456' });
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('invalid_credentials');
    });

    it('/me без cookie → 401 unauthorized', async () => {
      const client = new TestClient(server);
      const response = await client.get('/api/auth/me');
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('unauthorized');
    });

    it('logout завершает сессию', async () => {
      const { client } = await registerAndVerify('logout@example.com', 'logoutuser');

      expect((await client.post('/api/auth/logout')).status).toBe(204);
      expect((await client.get('/api/auth/me')).status).toBe(401);

      const session = await prisma.session.findFirst();
      expect(session?.revokedAt).toBeInstanceOf(Date);
    });

    it('список сессий и отзыв другой сессии', async () => {
      const { client: first } = await registerAndVerify('multi@example.com', 'multiuser');

      const second = new TestClient(server);
      await second.csrf();
      await second.post('/api/auth/login', { email: 'multi@example.com', password: PASSWORD });

      const list = await first.get('/api/auth/sessions');
      expect(list.status).toBe(200);
      expect(list.body.sessions).toHaveLength(2);
      expect(list.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
      expect(list.body.sessions[0]).not.toHaveProperty('tokenHash');

      const other = list.body.sessions.find((s: { current: boolean }) => !s.current);
      expect((await first.del(`/api/auth/sessions/${other.id}`)).status).toBe(204);
      expect((await second.get('/api/auth/me')).status).toBe(401);

      const after = await first.get('/api/auth/sessions');
      expect(after.body.sessions).toHaveLength(1);
    });
  });

  describe('Ограничение частоты входов (ТЗ §6)', () => {
    it('блокирует шестую попытку входа (429 rate_limited)', async () => {
      await registerAndVerify('flood@example.com', 'flooduser');
      const client = new TestClient(server);
      await client.csrf();

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await client.post('/api/auth/login', {
          email: 'flood@example.com',
          password: 'WrongPass1',
        });
        expect(response.status).toBe(401);
      }

      const blocked = await client.post('/api/auth/login', { email: 'flood@example.com', password: 'WrongPass1' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('rate_limited');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('Онбординг (ТЗ §3.1)', () => {
    it('сохраняет 4 шага, создаёт первый счёт и завершает онбординг', async () => {
      const { client, userId } = await registerAndVerify('onboard@example.com', 'onboarduser');

      const payload = {
        timezone: 'Europe/Berlin',
        currency: 'EUR',
        locale: 'en',
        goals: ['money', 'habits'],
        notificationsEnabled: false,
        quietHoursStart: 23,
        quietHoursEnd: 7,
        profileVisibility: 'subscribers',
        firstAccount: { name: 'Карта', type: 'card', balance: 1500.5 },
      };

      const response = await client.put('/api/auth/onboarding', payload);
      expect(response.status).toBe(200);
      expect(response.body.onboardingCompleted).toBe(true);
      expect(response.body.user).toMatchObject({
        timezone: 'Europe/Berlin',
        currency: 'EUR',
        locale: 'en',
        goals: ['money', 'habits'],
        profileVisibility: 'subscribers',
        onboardingCompleted: true,
      });

      const stored = await prisma.user.findUnique({ where: { id: userId }, include: { accounts: true } });
      expect(stored?.notificationsEnabled).toBe(false);
      expect(stored?.quietHoursStart).toBe(23);
      expect(stored?.onboardingStep).toBe(4);
      expect(stored?.accounts).toHaveLength(1);
      expect(stored?.accounts[0]).toMatchObject({ name: 'Карта', type: 'card', currency: 'EUR' });
      expect(Number(stored?.accounts[0].balance)).toBe(1500.5);

      const me = await client.get('/api/auth/me');
      expect(me.body.onboardingCompleted).toBe(true);
    });

    it('требует авторизацию и минимум одну цель', async () => {
      const { client } = await registerAndVerify('bad-onboard@example.com', 'badonboard');
      const response = await client.put('/api/auth/onboarding', {
        timezone: 'UTC',
        currency: 'RUB',
        goals: [],
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('validation_error');
    });
  });
});
