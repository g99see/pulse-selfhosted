// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты жалоб и модерации (ТЗ §2, §3.7, §3.8) против реального
// PostgreSQL в схеме puls_test. Запуск: pnpm --filter @puls/api test
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModerationActionDto, ReportDto } from '@puls/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { ModerationService } from '../src/moderation/moderation.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestClient } from './client';

const PASSWORD = 'Secret12345';

describe('Жалобы и модерация (интеграция с PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;
  let moderation: ModerationService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
    moderation = app.get(ModerationService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    // Удаляем только свои данные; чужие таблицы параллельных агентов не трогаем.
    const statements = [
      'DELETE FROM "moderation_actions"',
      'DELETE FROM "content_flags"',
      'DELETE FROM "reports"',
      'DELETE FROM "sessions"',
      'DELETE FROM "email_verification_tokens"',
      'DELETE FROM "check_ins"',
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
  });

  async function signUp(email: string, nickname: string): Promise<TestClient> {
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
    return client;
  }

  /** Даёт пользователю роль модератора прямо в БД (вход уже выполнен). */
  async function promote(email: string, role: 'moderator' | 'admin'): Promise<void> {
    await prisma.user.update({ where: { email }, data: { role } });
  }

  describe('Приём жалоб (ТЗ §3.7)', () => {
    it('любой вошедший может пожаловаться на контент', async () => {
      const client = await signUp('report@example.com', 'reporter');
      const response = await client.post('/api/reports', {
        targetType: 'comment',
        targetId: 'comment-1',
        reason: 'spam',
        details: 'Реклама в комментариях',
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        targetType: 'comment',
        targetId: 'comment-1',
        reason: 'spam',
        details: 'Реклама в комментариях',
        status: 'open',
      });
      expect((response.body as ReportDto).reporter.nickname).toBe('reporter');
    });

    it('без сессии — 401, невалидное тело — 400', async () => {
      const anon = new TestClient(server);
      await anon.csrf();
      expect(
        (await anon.post('/api/reports', { targetType: 'post', targetId: 'p1', reason: 'spam' }))
          .status,
      ).toBe(401);

      const client = await signUp('report-bad@example.com', 'reportbad');
      expect(
        (await client.post('/api/reports', { targetType: 'nope', targetId: 'p1', reason: 'spam' }))
          .status,
      ).toBe(400);
      expect(
        (await client.post('/api/reports', { targetType: 'post', targetId: '', reason: 'spam' }))
          .status,
      ).toBe(400);
      // Пояснение длиннее 1000 символов не проходит (ТЗ §3.7).
      expect(
        (
          await client.post('/api/reports', {
            targetType: 'post',
            targetId: 'p1',
            reason: 'spam',
            details: 'x'.repeat(1001),
          })
        ).status,
      ).toBe(400);
    });

    it('нельзя жаловаться на собственный профиль', async () => {
      const client = await signUp('report-self@example.com', 'reportself');
      const me = (await client.get('/api/auth/me')).body as { user: { id: string } };

      const response = await client.post('/api/reports', {
        targetType: 'profile',
        targetId: me.user.id,
        reason: 'other',
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('report_self');
    });

    it('дубль от того же автора на ту же цель блокируется', async () => {
      const client = await signUp('report-dupe@example.com', 'reportdupe');
      const body = { targetType: 'post' as const, targetId: 'post-42', reason: 'abuse' as const };

      expect((await client.post('/api/reports', body)).status).toBe(201);
      const second = await client.post('/api/reports', body);
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('report_duplicate');
    });

    it('ограничивает частоту жалоб (ТЗ §6)', async () => {
      const client = await signUp('report-flood@example.com', 'reportflood');

      for (let index = 0; index < 10; index += 1) {
        const response = await client.post('/api/reports', {
          targetType: 'post',
          targetId: `flood-${index}`,
          reason: 'spam',
        });
        expect(response.status).toBe(201);
      }

      const blocked = await client.post('/api/reports', {
        targetType: 'post',
        targetId: 'flood-final',
        reason: 'spam',
      });
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('rate_limited');
    });
  });

  describe('Очередь модерации (ТЗ §2, §3.8)', () => {
    it('обычный пользователь не имеет доступа — 403', async () => {
      const client = await signUp('report-user@example.com', 'reportuser');
      expect((await client.get('/api/moderation/reports')).status).toBe(403);
      expect((await client.get('/api/moderation/actions')).status).toBe(403);
      expect(
        (await client.post('/api/moderation/reports/whatever/resolve', { action: 'hide' })).status,
      ).toBe(403);
    });

    it('модератор видит жалобу и скрывает цель по ней', async () => {
      const reporterClient = await signUp('report-rep@example.com', 'reportrep');
      const moderatorClient = await signUp('report-mod@example.com', 'reportmod');
      await promote('report-mod@example.com', 'moderator');

      const created = await reporterClient.post('/api/reports', {
        targetType: 'html_page',
        targetId: 'page-7',
        reason: 'phishing',
        details: 'Форма собирает пароли',
      });
      expect(created.status).toBe(201);

      const list = await moderatorClient.get('/api/moderation/reports?status=open');
      expect(list.status).toBe(200);
      const reports = (list.body as { reports: ReportDto[] }).reports;
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        targetType: 'html_page',
        targetId: 'page-7',
        reason: 'phishing',
        status: 'open',
      });
      expect(reports[0].reporter.nickname).toBe('reportrep');

      const resolved = await moderatorClient.post(
        `/api/moderation/reports/${reports[0].id}/resolve`,
        { action: 'ban_html', note: 'Фишинг подтверждён' },
      );
      expect(resolved.status).toBe(201);
      const resolvedBody = resolved.body as { report: ReportDto; action: ModerationActionDto };
      expect(resolvedBody.report.status).toBe('resolved');
      expect(resolvedBody.report.resolution).toBe('Фишинг подтверждён');
      expect(resolvedBody.action).toMatchObject({ action: 'ban_html', targetId: 'page-7' });
      expect(resolvedBody.action.moderator.nickname).toBe('reportmod');

      // Цель помечена скрытой — это видят другие блоки через ModerationService.
      expect(await moderation.isHidden('html_page', 'page-7')).toBe(true);
      expect(await moderation.isHidden('html_page', 'other-page')).toBe(false);

      // Очередь открытых пуста, журнал содержит действие.
      const open = await moderatorClient.get('/api/moderation/reports?status=open');
      expect((open.body as { reports: ReportDto[] }).reports).toHaveLength(0);

      const actions = await moderatorClient.get('/api/moderation/actions');
      expect(actions.status).toBe(200);
      expect((actions.body as { actions: ModerationActionDto[] }).actions).toHaveLength(1);

      // Повторное решение по закрытой жалобе — 409.
      const again = await moderatorClient.post(`/api/moderation/reports/${reports[0].id}/resolve`, {
        action: 'dismiss',
      });
      expect(again.status).toBe(409);
    });

    it('отклонение жалобы не скрывает цель, admin имеет доступ', async () => {
      const reporterClient = await signUp('report-rep2@example.com', 'reportrep2');
      const adminClient = await signUp('report-admin@example.com', 'reportadmin');
      await promote('report-admin@example.com', 'admin');

      const created = await reporterClient.post('/api/reports', {
        targetType: 'profile',
        targetId: 'some-profile',
        reason: 'other',
      });
      const reportId = (created.body as ReportDto).id;

      const resolved = await adminClient.post(`/api/moderation/reports/${reportId}/resolve`, {
        action: 'dismiss',
        note: 'Нарушений нет',
      });
      expect(resolved.status).toBe(201);
      expect((resolved.body as { report: ReportDto }).report.status).toBe('dismissed');

      expect(await moderation.isHidden('profile', 'some-profile')).toBe(false);
    });
  });
});
