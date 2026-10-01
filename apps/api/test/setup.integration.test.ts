// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты мастера первого запуска и режима регистрации
// (ТЗ §6, §9 п.7, §10) против реального PostgreSQL в схеме puls_test.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestClient } from './client';

const PASSWORD = 'Secret12345';

describe('Мастер первого запуска (интеграция с PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma?.instanceSettings.deleteMany();
    await app?.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "instance_settings", "users", "sessions", "email_verification_tokens", "accounts", "check_ins" RESTART IDENTITY CASCADE',
    );
  });

  // Настройки инстанса чистим после каждого теста: иначе режим closed
  // протёк бы в тесты регистрации, идущие следом.
  afterEach(async () => {
    await prisma.instanceSettings.deleteMany();
  });

  function client(): TestClient {
    return new TestClient(server);
  }

  async function setupAdmin(c: TestClient, email = 'admin@example.com', nickname = 'root') {
    await c.csrf();
    return c.post('/api/setup', { email, password: PASSWORD, nickname });
  }

  describe('GET /api/setup/status', () => {
    it('на пустой БД сообщает needsSetup и открытую регистрацию', async () => {
      const response = await client().get('/api/setup/status');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ needsSetup: true, registrationMode: 'open' });
    });

    it('после появления пользователя needsSetup становится false', async () => {
      const c = client();
      await setupAdmin(c);

      const response = await c.get('/api/setup/status');
      expect(response.body.needsSetup).toBe(false);
    });

    it('отдаёт сохранённый режим регистрации', async () => {
      await prisma.instanceSettings.create({
        data: { id: 'instance', registrationMode: 'closed' },
      });

      const response = await client().get('/api/setup/status');
      expect(response.body.registrationMode).toBe('closed');
    });
  });

  describe('POST /api/setup', () => {
    it('создаёт первого пользователя с ролью admin и подтверждённой почтой', async () => {
      const response = await setupAdmin(client());

      expect(response.status).toBe(201);
      expect(response.body.user).toMatchObject({ email: 'admin@example.com', role: 'admin' });
      expect(response.body.user).not.toHaveProperty('passwordHash');

      const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
      expect(stored.role).toBe('admin');
      expect(stored.emailVerifiedAt).not.toBeNull();
      expect(stored.passwordHash?.startsWith('$argon2id$')).toBe(true);
    });

    it('требует CSRF-токен (ТЗ §6)', async () => {
      const response = await import('supertest').then(({ default: request }) =>
        request(server)
          .post('/api/setup')
          .send({ email: 'admin@example.com', password: PASSWORD, nickname: 'root' }),
      );

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('csrf_failed');
    });

    it('блокируется навсегда после создания первого администратора', async () => {
      const c = client();
      await setupAdmin(c);

      const again = await c.post('/api/setup', {
        email: 'other@example.com',
        password: PASSWORD,
        nickname: 'second',
      });

      expect(again.status).toBe(409);
      expect(again.body.code).toBe('setup_completed');
      expect(await prisma.user.count()).toBe(1);
    });

    it('гонка двух одновременных вызовов создаёт ровно одного администратора', async () => {
      const c = client();
      await c.csrf();

      const [first, second] = await Promise.all([
        c.post('/api/setup', { email: 'race-a@example.com', password: PASSWORD, nickname: 'racea' }),
        c.post('/api/setup', { email: 'race-b@example.com', password: PASSWORD, nickname: 'raceb' }),
      ]);

      const statuses = [first.status, second.status].sort((a, b) => a - b);
      expect(statuses).toEqual([201, 409]);

      const admins = await prisma.user.count({ where: { role: 'admin' } });
      expect(admins).toBe(1);
      expect(await prisma.user.count()).toBe(1);
    });

    it('валидирует поля (короткий пароль)', async () => {
      const c = client();
      await c.csrf();

      const response = await c.post('/api/setup', {
        email: 'admin@example.com',
        password: 'short',
        nickname: 'root',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('режим регистрации (ТЗ §9 п.7)', () => {
    it('существующие пользователи по умолчанию получают роль user', async () => {
      const c = client();
      await c.csrf();
      const registered = await c.post('/api/auth/register', {
        email: 'plain@example.com',
        password: PASSWORD,
        nickname: 'plain',
      });

      expect(registered.status).toBe(201);
      expect(registered.body.user.role).toBe('user');
    });

    it('при registrationMode=closed отвечает 403 registration_closed', async () => {
      await prisma.instanceSettings.create({
        data: { id: 'instance', registrationMode: 'closed' },
      });

      const c = client();
      await c.csrf();
      const response = await c.post('/api/auth/register', {
        email: 'late@example.com',
        password: PASSWORD,
        nickname: 'late',
      });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('registration_closed');
      expect(await prisma.user.count()).toBe(0);
    });

    it('при registrationMode=invite отвечает 403 registration_invite_required', async () => {
      await prisma.instanceSettings.create({
        data: { id: 'instance', registrationMode: 'invite' },
      });

      const c = client();
      await c.csrf();
      const response = await c.post('/api/auth/register', {
        email: 'invited@example.com',
        password: PASSWORD,
        nickname: 'invited',
      });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('registration_invite_required');
    });
  });
});
