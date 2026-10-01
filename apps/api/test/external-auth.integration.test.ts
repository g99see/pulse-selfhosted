// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты внешнего входа (ТЗ §3.1, §7): Google OAuth2/OIDC с PKCE
// (шлюз подменён фейком — реальных запросов к Google нет) и Telegram Login Widget
// (подпись, подделка, просрочка). Проверяются также привязка по подтверждённому
// email, генерация никнейма при коллизии, отвязка и изоляция по пользователю.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthModule } from '../src/auth/auth.module';
import { ExternalAuthModule } from '../src/auth/external/external-auth.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import {
  GOOGLE_OAUTH_GATEWAY,
  type GoogleAuthUrlInput,
  type GoogleCodeExchangeInput,
  type GoogleOAuthGateway,
} from '../src/auth/external/google.gateway';
import { OAUTH_STATE_COOKIE } from '../src/auth/external/external-auth.controller';
import type { GoogleIdTokenClaims } from '../src/auth/external/google.tokens';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestClient } from './client';

const PASSWORD = 'Secret12345';
const BOT_TOKEN = '999:TEST-BOT-TOKEN';
const BOT_USERNAME = 'puls_test_bot';
const GOOGLE_CLIENT_ID = 'puls-test.apps.googleusercontent.com';

/** Фейковый шлюз Google: реальный HTTP не выполняется (ТЗ §7). */
class FakeGoogleGateway implements GoogleOAuthGateway {
  claims: GoogleIdTokenClaims = googleClaims();
  exchangeError: Error | null = null;
  verifyError: Error | null = null;
  lastExchange: GoogleCodeExchangeInput | null = null;
  authUrls: GoogleAuthUrlInput[] = [];

  buildAuthUrl(input: GoogleAuthUrlInput): string {
    this.authUrls.push(input);
    const params = new URLSearchParams({
      state: input.state,
      code_challenge: input.codeChallenge,
      client_id: input.clientId,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(input: GoogleCodeExchangeInput): Promise<{ idToken: string }> {
    this.lastExchange = input;
    if (this.exchangeError) throw this.exchangeError;
    return { idToken: 'fake-id-token' };
  }

  async verifyIdToken(): Promise<GoogleIdTokenClaims> {
    if (this.verifyError) throw this.verifyError;
    return this.claims;
  }
}

function googleClaims(overrides: Partial<GoogleIdTokenClaims> = {}): GoogleIdTokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://accounts.google.com',
    aud: GOOGLE_CLIENT_ID,
    sub: 'google-subject-1',
    email: 'google-user@example.com',
    email_verified: true,
    iat: now - 10,
    exp: now + 3600,
    ...overrides,
  };
}

function signTelegram(
  payload: Record<string, unknown>,
  botToken = BOT_TOKEN,
): Record<string, unknown> {
  const checkString = Object.entries(payload)
    .filter(([key, value]) => key !== 'hash' && value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort()
    .join('\n');
  const hash = createHmac('sha256', createHash('sha256').update(botToken).digest())
    .update(checkString)
    .digest('hex');
  return { ...payload, hash };
}

function setCookies(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? (raw as string[]) : [String(raw)];
}

function cookieValue(
  response: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  for (const cookie of setCookies(response)) {
    const [pair] = cookie.split(';');
    const index = pair.indexOf('=');
    if (pair.slice(0, index).trim() === name) return pair.slice(index + 1);
  }
  return undefined;
}

function stateFromLocation(location: string | undefined): string {
  return new URL(location ?? 'https://example.invalid').searchParams.get('state') ?? '';
}

/** TestClient вбирает cookie только у POST/PUT/DELETE; для GET-редиректов делаем сами. */
function absorbCookies(client: TestClient, response: { headers: Record<string, unknown> }): void {
  for (const cookie of setCookies(response)) {
    const [pair] = cookie.split(';');
    const index = pair.indexOf('=');
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1);
    if (value === '') delete client.cookies[name];
    else client.cookies[name] = value;
  }
}

describe('Внешний вход: Google и Telegram (интеграция)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;
  let google: FakeGoogleGateway;

  beforeAll(async () => {
    google = new FakeGoogleGateway();
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, AuthModule, ExternalAuthModule],
    })
      .overrideProvider(GOOGLE_OAUTH_GATEWAY)
      .useValue(google)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
  });

  afterAll(async () => {
    await app?.close();
    restoreEnv();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "users", "sessions", "email_verification_tokens", "external_identities", "accounts", "check_ins" RESTART IDENTITY CASCADE',
    );
    mail.clearOutbox();
    restoreEnv();
    google.claims = googleClaims();
    google.exchangeError = null;
    google.verifyError = null;
    google.lastExchange = null;
    google.authUrls = [];
  });

  afterEach(() => {
    restoreEnv();
  });

  function useGoogle(): void {
    process.env.GOOGLE_CLIENT_ID = GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  }

  function useTelegram(): void {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    process.env.TELEGRAM_BOT_USERNAME = BOT_USERNAME;
  }

  function restoreEnv(): void {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_USERNAME;
  }

  async function registerAndVerify(
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

  describe('Список провайдеров (ТЗ §3.1)', () => {
    it('без ключей владельца всё выключено', async () => {
      const client = new TestClient(server);
      const response = await client.get('/api/auth/providers');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ google: false, telegram: false, telegramBotUsername: null });
    });

    it('с ключами сообщает о включённых провайдерах', async () => {
      useGoogle();
      useTelegram();
      const response = await new TestClient(server).get('/api/auth/providers');
      expect(response.body).toEqual({
        google: true,
        telegram: true,
        telegramBotUsername: BOT_USERNAME,
      });
    });
  });

  describe('Выключенный провайдер отвечает 404 (ТЗ §3.1)', () => {
    it('google/start → 404 provider_disabled', async () => {
      const response = await new TestClient(server).get('/api/auth/google/start');
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('provider_disabled');
    });

    it('telegram → 404 provider_disabled', async () => {
      const client = new TestClient(server);
      await client.csrf();
      const response = await client.post(
        '/api/auth/telegram',
        signTelegram({ id: 1, auth_date: Math.floor(Date.now() / 1000) }),
      );
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('provider_disabled');
    });
  });

  describe('Google OAuth (ТЗ §7)', () => {
    it('start отдаёт redirect на Google с PKCE и httpOnly-cookie state', async () => {
      useGoogle();
      const response = await request(server)
        .get('/api/auth/google/start')
        .set('X-Forwarded-For', '10.1.0.1');

      expect(response.status).toBe(302);
      const location = response.headers.location as string;
      expect(location).toContain('accounts.google.com');
      expect(location).toContain('code_challenge=');

      const state = stateFromLocation(location);
      expect(state.length).toBeGreaterThan(20);
      expect(cookieValue(response, OAUTH_STATE_COOKIE)).toBe(state);
      expect(
        setCookies(response).find((cookie) => cookie.startsWith(OAUTH_STATE_COOKIE)),
      ).toContain('HttpOnly');
      expect(google.lastExchange).toBeNull();
      expect(google.authUrls[0].codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('callback создаёт пользователя с подтверждённым email и выдаёт сессию', async () => {
      useGoogle();
      const start = await request(server)
        .get('/api/auth/google/start')
        .set('X-Forwarded-For', '10.1.0.2');
      const state = stateFromLocation(start.headers.location as string);
      const client = new TestClient(server);
      client.cookies[OAUTH_STATE_COOKIE] = state;

      const callback = await client.get(`/api/auth/google/callback?code=auth-code&state=${state}`);
      absorbCookies(client, callback);

      expect(callback.status).toBe(302);
      expect(callback.headers.location).toContain('/onboarding');
      expect(client.cookies['puls_session']).toBeTruthy();

      const user = await prisma.user.findUnique({ where: { email: 'google-user@example.com' } });
      expect(user?.passwordHash).toBeNull();
      expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
      const identity = await prisma.externalIdentity.findUnique({
        where: { provider_subject: { provider: 'google', subject: 'google-subject-1' } },
      });
      expect(identity?.userId).toBe(user?.id);
      expect(identity?.email).toBe('google-user@example.com');

      const me = await client.get('/api/auth/me');
      expect(me.body.user.emailVerified).toBe(true);
      expect(me.body.needsEmail).toBe(false);
    });

    it('привязывает Google к существующему пользователю с тем же подтверждённым email', async () => {
      const { userId } = await registerAndVerify('google-user@example.com', 'existinguser');
      // Снимаем подтверждение, чтобы проверить авто-подтверждение по Google.
      await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: null } });

      useGoogle();
      const start = await request(server)
        .get('/api/auth/google/start')
        .set('X-Forwarded-For', '10.1.0.3');
      const state = stateFromLocation(start.headers.location as string);
      const client = new TestClient(server);
      client.cookies[OAUTH_STATE_COOKIE] = state;
      const callback = await client.get(`/api/auth/google/callback?code=c&state=${state}`);

      expect(callback.status).toBe(302);
      expect(await prisma.user.count({ where: { email: 'google-user@example.com' } })).toBe(1);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(stored.passwordHash).not.toBeNull();
      expect(stored.emailVerifiedAt).toBeInstanceOf(Date);
      const identity = await prisma.externalIdentity.findFirst({
        where: { userId, provider: 'google' },
      });
      expect(identity?.subject).toBe('google-subject-1');
    });

    it('не привязывает при email_verified=false, создаёт пользователя с техническим адресом', async () => {
      useGoogle();
      google.claims = googleClaims({
        sub: 'no-email-sub',
        email: undefined,
        email_verified: false,
      });
      const start = await request(server)
        .get('/api/auth/google/start')
        .set('X-Forwarded-For', '10.1.0.4');
      const state = stateFromLocation(start.headers.location as string);
      const client = new TestClient(server);
      client.cookies[OAUTH_STATE_COOKIE] = state;
      absorbCookies(client, await client.get(`/api/auth/google/callback?code=c&state=${state}`));

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'g-no-email-sub@google.invalid' },
      });
      expect(user.emailVerifiedAt).toBeNull();
      const me = await client.get('/api/auth/me');
      expect(me.body.needsEmail).toBe(true);
    });

    it('не даёт использовать state второй раз (replay)', async () => {
      useGoogle();
      const start = await request(server)
        .get('/api/auth/google/start')
        .set('X-Forwarded-For', '10.1.0.5');
      const state = stateFromLocation(start.headers.location as string);
      const client = new TestClient(server);
      client.cookies[OAUTH_STATE_COOKIE] = state;

      const first = await client.get(`/api/auth/google/callback?code=c&state=${state}`);
      expect(first.headers.location).not.toContain('error=');

      const replay = await client.get(`/api/auth/google/callback?code=c&state=${state}`);
      expect(replay.headers.location).toContain('/login?error=oauth_state');
    });

    it('отклоняет чужой state из cookie', async () => {
      useGoogle();
      const start = await request(server)
        .get('/api/auth/google/start')
        .set('X-Forwarded-For', '10.1.0.6');
      const state = stateFromLocation(start.headers.location as string);
      const client = new TestClient(server);
      client.cookies[OAUTH_STATE_COOKIE] = 'another-state-value';

      const response = await client.get(`/api/auth/google/callback?code=c&state=${state}`);
      expect(response.headers.location).toContain('/login?error=oauth_state');
      expect(
        await prisma.user.findUnique({ where: { email: 'google-user@example.com' } }),
      ).toBeNull();
    });

    it('отклоняет ошибку обмена кода', async () => {
      useGoogle();
      google.exchangeError = new Error('boom');
      const start = await request(server)
        .get('/api/auth/google/start')
        .set('X-Forwarded-For', '10.1.0.7');
      const state = stateFromLocation(start.headers.location as string);
      const client = new TestClient(server);
      client.cookies[OAUTH_STATE_COOKIE] = state;
      const response = await client.get(`/api/auth/google/callback?code=c&state=${state}`);
      expect(response.headers.location).toContain('/login?error=oauth_exchange');
      expect(
        await prisma.user.findUnique({ where: { email: 'google-user@example.com' } }),
      ).toBeNull();
    });
  });

  describe('Telegram Login Widget (ТЗ §7)', () => {
    it('входит по корректной подписи и создаёт пользователя без пароля', async () => {
      useTelegram();
      const client = new TestClient(server);
      await client.csrf();
      const now = Math.floor(Date.now() / 1000);

      const response = await client.post(
        '/api/auth/telegram',
        signTelegram({ id: 555, first_name: 'Dmitro', username: 'dmitro', auth_date: now }),
      );

      expect(response.status).toBe(200);
      expect(client.cookies['puls_session']).toBeTruthy();
      expect(response.body.needsEmail).toBe(true);

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'tg-555@telegram.invalid' },
      });
      expect(user.passwordHash).toBeNull();
      expect(user.emailVerifiedAt).toBeNull();
      expect(user.nickname).toMatch(/^[a-z0-9][a-z0-9_-]{2,31}$/);

      const me = await client.get('/api/auth/me');
      expect(me.body.needsEmail).toBe(true);
      expect(me.body.user.email).toBe('tg-555@telegram.invalid');
    });

    it('повторный вход возвращает того же пользователя', async () => {
      useTelegram();
      const now = Math.floor(Date.now() / 1000);
      const payload = signTelegram({ id: 777, first_name: 'Ann', auth_date: now });

      const first = new TestClient(server);
      await first.csrf();
      expect((await first.post('/api/auth/telegram', payload)).status).toBe(200);

      const second = new TestClient(server);
      await second.csrf();
      expect((await second.post('/api/auth/telegram', payload)).status).toBe(200);

      expect(
        await prisma.user.findUnique({ where: { email: 'tg-777@telegram.invalid' } }),
      ).not.toBeNull();
      expect(
        await prisma.externalIdentity.count({ where: { provider: 'telegram', subject: '777' } }),
      ).toBe(1);
    });

    it('отклоняет подделанную подпись (401)', async () => {
      useTelegram();
      const client = new TestClient(server);
      await client.csrf();
      const payload = signTelegram({ id: 1, auth_date: Math.floor(Date.now() / 1000) });
      payload.id = 2;

      const response = await client.post('/api/auth/telegram', payload);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('invalid_telegram_auth');
      expect(
        await prisma.externalIdentity.findFirst({ where: { provider: 'telegram', subject: '2' } }),
      ).toBeNull();
    });

    it('отклоняет просроченный auth_date (401)', async () => {
      useTelegram();
      const client = new TestClient(server);
      await client.csrf();
      const stale = Math.floor(Date.now() / 1000) - 26 * 60 * 60;

      const response = await client.post(
        '/api/auth/telegram',
        signTelegram({ id: 3, auth_date: stale }),
      );
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('invalid_telegram_auth');
      expect(
        await prisma.externalIdentity.findFirst({ where: { provider: 'telegram', subject: '3' } }),
      ).toBeNull();
    });

    it('разные Telegram-аккаунты получают разные (уникальные) никнеймы', async () => {
      useTelegram();
      const now = Math.floor(Date.now() / 1000);
      for (const id of [11, 12, 13]) {
        const client = new TestClient(server);
        await client.csrf();
        expect(
          (await client.post('/api/auth/telegram', signTelegram({ id, auth_date: now }))).status,
        ).toBe(200);
      }

      const nicknames = await prisma.user.findMany({
        where: {
          email: {
            in: ['tg-11@telegram.invalid', 'tg-12@telegram.invalid', 'tg-13@telegram.invalid'],
          },
        },
      });
      expect(nicknames).toHaveLength(3);
      const values = nicknames.map((user) => user.nickname);
      expect(new Set(values).size).toBe(3);
      for (const nickname of values) expect(nickname).toMatch(/^[a-z0-9][a-z0-9_-]{2,31}$/);
    });

    it('вход по паролю для Telegram-аккаунта невозможен (invalid_credentials)', async () => {
      useTelegram();
      const client = new TestClient(server);
      await client.csrf();
      const now = Math.floor(Date.now() / 1000);
      await client.post('/api/auth/telegram', signTelegram({ id: 900, auth_date: now }));

      const fresh = new TestClient(server);
      await fresh.csrf();
      const response = await fresh.post('/api/auth/login', {
        email: 'tg-900@telegram.invalid',
        password: PASSWORD,
      });
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('invalid_credentials');
    });
  });

  describe('Привязки в настройках (ТЗ §3.1)', () => {
    it('список привязок требует вход', async () => {
      const response = await new TestClient(server).get('/api/auth/identities');
      expect(response.status).toBe(401);
    });

    it('привязывает Telegram к аккаунту с паролем и отвязывает его', async () => {
      const { client } = await registerAndVerify('linker@example.com', 'linkeruser');
      useTelegram();
      const now = Math.floor(Date.now() / 1000);

      const linked = await client.post(
        '/api/auth/link/telegram',
        signTelegram({ id: 4242, first_name: 'Link', auth_date: now }),
      );
      expect(linked.status).toBe(200);
      expect(linked.body.passwordSet).toBe(true);
      expect(linked.body.identities.map((item: { provider: string }) => item.provider)).toEqual([
        'telegram',
      ]);

      const removed = await client.del('/api/auth/identities/telegram');
      expect(removed.status).toBe(204);

      const after = await client.get('/api/auth/identities');
      expect(after.body.identities).toEqual([]);
    });

    it('нельзя отвязать единственный способ входа (409 last_login_method)', async () => {
      useTelegram();
      const client = new TestClient(server);
      await client.csrf();
      await client.post(
        '/api/auth/telegram',
        signTelegram({ id: 31337, auth_date: Math.floor(Date.now() / 1000) }),
      );

      const response = await client.del('/api/auth/identities/telegram');
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('last_login_method');
      expect(
        await prisma.externalIdentity.count({ where: { provider: 'telegram', subject: '31337' } }),
      ).toBe(1);
    });

    it('привязка Google из настроек через OAuth-поток', async () => {
      const { client, userId } = await registerAndVerify('settings@example.com', 'settingsuser');
      useGoogle();

      const start = await client.get('/api/auth/link/google/start');
      expect(start.status).toBe(302);
      const state = stateFromLocation(start.headers.location as string);
      // start через TestClient.get не вбирает cookie — берём state напрямую.
      client.cookies[OAUTH_STATE_COOKIE] = state;

      const callback = await client.get(`/api/auth/google/callback?code=c&state=${state}`);
      expect(callback.headers.location).toContain('/settings?linked=google');

      const identities = await client.get('/api/auth/identities');
      expect(identities.body.identities.map((item: { provider: string }) => item.provider)).toEqual(
        ['google'],
      );
      expect(identities.body.passwordSet).toBe(true);
      expect(google.lastExchange?.clientId).toBe(GOOGLE_CLIENT_ID);

      const stored = await prisma.externalIdentity.findFirst({
        where: { userId, provider: 'google' },
      });
      expect(stored).not.toBeNull();
    });

    it('чужая привязка не перехватывается (409 identity_taken)', async () => {
      await registerAndVerify('owner@example.com', 'owneruser');
      const { client: second } = await registerAndVerify('thief@example.com', 'thiefuser');
      useGoogle();

      // Владелец уже привязал subject google-subject-1.
      await prisma.externalIdentity.create({
        data: {
          userId: (await prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.com' } }))
            .id,
          provider: 'google',
          subject: 'google-subject-1',
          email: 'owner@example.com',
        },
      });

      const start = await second.get('/api/auth/link/google/start');
      const state = stateFromLocation(start.headers.location as string);
      second.cookies[OAUTH_STATE_COOKIE] = state;
      const callback = await second.get(`/api/auth/google/callback?code=c&state=${state}`);

      expect(callback.headers.location).toContain('/settings?error=link_failed');
      const thief = await prisma.user.findUniqueOrThrow({ where: { email: 'thief@example.com' } });
      expect(await prisma.externalIdentity.count({ where: { userId: thief.id } })).toBe(0);
    });

    it('привязки изолированы по пользователю', async () => {
      const { client: first } = await registerAndVerify('iso-a@example.com', 'isoauser');
      const { client: second } = await registerAndVerify('iso-b@example.com', 'isobuser');
      useTelegram();
      await first.post(
        '/api/auth/link/telegram',
        signTelegram({ id: 8080, auth_date: Math.floor(Date.now() / 1000) }),
      );

      const other = await second.get('/api/auth/identities');
      expect(other.body.identities).toEqual([]);
      expect(other.body.passwordSet).toBe(true);
    });
  });
});
