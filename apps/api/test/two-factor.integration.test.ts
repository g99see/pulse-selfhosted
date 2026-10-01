// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты 2FA TOTP (ТЗ §6) против реального PostgreSQL (схема
// puls_test) и реального шифрования секрета AES-256-GCM.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { totp } from '../src/crypto/totp';
import { TestClient } from './client';

const PASSWORD = 'Secret12345';
/** Фиксированный «сейчас» для детерминированных TOTP-кодов. */
const BASE_TIME = 1_700_000_000_000;
const STEP_MS = 30_000;

describe('2FA TOTP (интеграция)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;
  let ipCounter = 0;

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
    vi.useRealTimers();
    await app?.close();
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(BASE_TIME);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" RESTART IDENTITY CASCADE');
    mail.clearOutbox();
  });

  function nextClient(): TestClient {
    ipCounter += 1;
    return new TestClient(server, `10.1.0.${ipCounter}`);
  }

  async function registerAndVerify(): Promise<{
    client: TestClient;
    userId: string;
    email: string;
  }> {
    const email = `twofa-${ipCounter}-${Date.now()}@example.com`;
    const nickname = `twofa${Math.abs(ipCounter)}`;
    const client = nextClient();
    await client.csrf();
    const registered = await client.post('/api/auth/register', {
      email,
      password: PASSWORD,
      nickname,
    });
    expect(registered.status).toBe(201);

    const token = mail.lastVerificationTokenFor(email) as string;
    const verified = await client.post('/api/auth/verify-email', { token });
    expect(verified.status).toBe(200);
    return { client, userId: verified.body.user.id as string, email };
  }

  /** Включает 2FA и возвращает секрет, коды и шаг подтверждения. */
  async function enableTwoFactor(client: TestClient) {
    const setup = await client.post('/api/auth/2fa/setup');
    expect(setup.status).toBe(200);
    const secret = setup.body.secret as string;
    expect(setup.body.otpauthUri).toContain('otpauth://totp/');
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);

    const code = totp(secret, { timeMs: BASE_TIME });
    const enabled = await client.post('/api/auth/2fa/enable', { code });
    expect(enabled.status).toBe(200);
    expect(enabled.body.backupCodes).toHaveLength(10);
    return { secret, backupCodes: enabled.body.backupCodes as string[] };
  }

  it('статус 2FA доступен и выключен по умолчанию', async () => {
    const { client } = await registerAndVerify();
    const status = await client.get('/api/auth/2fa');
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ enabled: false, available: true });
  });

  it('настройка недоступна без сессии', async () => {
    const client = nextClient();
    await client.csrf();
    expect((await client.post('/api/auth/2fa/setup')).status).toBe(401);
  });

  it('setup прячет секрет в БД (шифрует), enable подтверждает кодом', async () => {
    const { client, userId } = await registerAndVerify();

    const setup = await client.post('/api/auth/2fa/setup');
    expect(setup.status).toBe(200);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.twoFaSecret).not.toBeNull();
    expect(stored.twoFaSecret).not.toContain(setup.body.secret);
    expect(stored.twoFaSecret?.startsWith('v1.')).toBe(true);
    expect(stored.twoFaEnabled).toBe(false);

    const wrong = await client.post('/api/auth/2fa/enable', { code: '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('invalid_code');

    const code = totp(setup.body.secret as string, { timeMs: BASE_TIME });
    const enabled = await client.post('/api/auth/2fa/enable', { code });
    expect(enabled.status).toBe(200);
    expect(enabled.body.backupCodes).toHaveLength(10);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.twoFaEnabled).toBe(true);
    expect(after.twoFaConfirmedAt).toBeInstanceOf(Date);
    expect(await prisma.twoFactorBackupCode.count({ where: { userId } })).toBe(10);
  });

  it('вход с 2FA: пароль -> пропуск без сессии -> код выдаёт сессию', async () => {
    const { client, email } = await registerAndVerify();
    const { secret } = await enableTwoFactor(client);

    const fresh = nextClient();
    await fresh.csrf();
    const login = await fresh.post('/api/auth/login', { email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.twoFactorRequired).toBe(true);
    expect(typeof login.body.challengeToken).toBe('string');
    expect(fresh.cookies['puls_session']).toBeUndefined();

    const done = await fresh.post('/api/auth/login/2fa', {
      challengeToken: login.body.challengeToken,
      code: totp(secret, { timeMs: BASE_TIME + STEP_MS }),
    });
    expect(done.status).toBe(200);
    expect(fresh.cookies['puls_session']).toBeTruthy();
    expect((await fresh.get('/api/auth/me')).status).toBe(200);
  });

  it('код входа одноразовый: повтор в окне отклоняется', async () => {
    const { client, email } = await registerAndVerify();
    const { secret } = await enableTwoFactor(client);

    const login = await client.post('/api/auth/login', { email, password: PASSWORD });
    const used = totp(secret, { timeMs: BASE_TIME + STEP_MS });

    expect(
      (
        await client.post('/api/auth/login/2fa', {
          challengeToken: login.body.challengeToken,
          code: used,
        })
      ).status,
    ).toBe(200);

    // Новый пропуск, тот же (уже использованный) код.
    const again = await client.post('/api/auth/login', { email, password: PASSWORD });
    const reuse = await client.post('/api/auth/login/2fa', {
      challengeToken: again.body.challengeToken,
      code: used,
    });
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('invalid_code');
  });

  it('код, использованный при включении, не подходит для входа (защита от повтора)', async () => {
    const { client, email } = await registerAndVerify();
    const setup = await client.post('/api/auth/2fa/setup');
    const secret = setup.body.secret as string;
    const enableCode = totp(secret, { timeMs: BASE_TIME });
    expect((await client.post('/api/auth/2fa/enable', { code: enableCode })).status).toBe(200);

    const login = await client.post('/api/auth/login', { email, password: PASSWORD });
    const reuse = await client.post('/api/auth/login/2fa', {
      challengeToken: login.body.challengeToken,
      code: enableCode,
    });
    expect(reuse.status).toBe(401);
  });

  it('резервный код входит один раз и больше не принимается', async () => {
    const { client, email } = await registerAndVerify();
    const { backupCodes } = await enableTwoFactor(client);

    const login = await client.post('/api/auth/login', { email, password: PASSWORD });
    const first = await client.post('/api/auth/login/2fa', {
      challengeToken: login.body.challengeToken,
      code: backupCodes[0],
    });
    expect(first.status).toBe(200);
    expect(client.cookies['puls_session']).toBeTruthy();

    const again = await client.post('/api/auth/login', { email, password: PASSWORD });
    const second = await client.post('/api/auth/login/2fa', {
      challengeToken: again.body.challengeToken,
      code: backupCodes[0],
    });
    expect(second.status).toBe(401);
  });

  it('чужой секрет не подходит для входа', async () => {
    const { client, email } = await registerAndVerify();
    await enableTwoFactor(client);

    // Другой пользователь со своим секретом.
    const other = await registerAndVerify();
    const { secret: otherSecret } = await enableTwoFactor(other.client);

    const login = await client.post('/api/auth/login', { email, password: PASSWORD });
    const withForeign = await client.post('/api/auth/login/2fa', {
      challengeToken: login.body.challengeToken,
      // Код, посчитанный из чужого секрета, не должен подойти.
      code: totp(otherSecret, { timeMs: BASE_TIME + STEP_MS }),
    });
    expect(withForeign.status).toBe(401);
  });

  it('лимит попыток второго фактора: шестая попытка -> 429', async () => {
    const { client, email } = await registerAndVerify();
    await enableTwoFactor(client);

    const login = await client.post('/api/auth/login', { email, password: PASSWORD });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await client.post('/api/auth/login/2fa', {
        challengeToken: login.body.challengeToken,
        code: '123456',
      });
      expect(response.status).toBe(401);
    }
    const blocked = await client.post('/api/auth/login/2fa', {
      challengeToken: login.body.challengeToken,
      code: '123456',
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('rate_limited');
  });

  it('disable требует пароль и код, после — обычный вход', async () => {
    const { client, email, userId } = await registerAndVerify();
    const { secret } = await enableTwoFactor(client);

    const wrongPassword = await client.post('/api/auth/2fa/disable', {
      password: 'WrongPass1',
      code: totp(secret, { timeMs: BASE_TIME + STEP_MS }),
    });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.code).toBe('invalid_password');

    const disabled = await client.post('/api/auth/2fa/disable', {
      password: PASSWORD,
      code: totp(secret, { timeMs: BASE_TIME + STEP_MS }),
    });
    expect(disabled.status).toBe(204);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.twoFaEnabled).toBe(false);
    expect(stored.twoFaSecret).toBeNull();
    expect(await prisma.twoFactorBackupCode.count({ where: { userId } })).toBe(0);

    const fresh = nextClient();
    await fresh.csrf();
    const login = await fresh.post('/api/auth/login', { email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe(email);
    expect(fresh.cookies['puls_session']).toBeTruthy();
  });

  it('выгрузка данных не содержит секретов 2FA', async () => {
    const { client } = await registerAndVerify();
    const { secret } = await enableTwoFactor(client);

    const exported = await client.get('/api/account/export?format=json');
    expect(exported.status).toBe(200);
    const body = JSON.stringify(exported.body);
    expect(body).not.toContain(secret);
    expect(body).not.toContain('two_fa_secret');
    expect(body).not.toContain('code_hash');
  });
});
