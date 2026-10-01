// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты челленджей (ТЗ §4, P2): создание, вступление по коду,
// приглашение из подписок, ежедневная отметка «держусь», рейтинг участников и
// приватность данных. Против реального PostgreSQL в схеме puls_test.
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

interface ChallengeDto {
  id: string;
  title: string;
  kind: string;
  durationDays: number;
  visibility: string;
  inviteCode: string;
  ownerId: string;
  ownerNickname: string;
  isOwner: boolean;
  isParticipating: boolean;
  participantsCount: number;
  heldDays: number;
  currentStreak: number;
  percent: number;
  dayNumber: number | null;
  checkedToday: boolean;
  participants: { userId: string; nickname: string; joinedAt: string }[];
}

interface LeaderboardDto {
  challengeId: string;
  entries: { rank: number; nickname: string; score: number; currentStreak: number }[];
}

const today = (): string => new Date().toISOString().slice(0, 10);

describe('Challenges API (интеграция с PostgreSQL)', () => {
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
    // Удаляем только свои данные; чужие таблицы параллельных агентов не трогаем.
    const statements = [
      'DELETE FROM "challenge_checks"',
      'DELETE FROM "challenge_participants"',
      'DELETE FROM "challenges"',
      'DELETE FROM "follows"',
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
  });

  async function signUp(email: string, nickname: string): Promise<TestClient> {
    const client = new TestClient(server);
    await client.csrf();
    const registered = await client.post('/api/auth/register', { email, password: PASSWORD, nickname });
    expect(registered.status).toBe(201);
    const token = mail.lastVerificationTokenFor(email);
    expect(token).toBeTruthy();
    const verified = await client.post('/api/auth/verify-email', { token });
    expect(verified.status).toBe(200);
    return client;
  }

  async function createChallenge(
    client: TestClient,
    body: Record<string, unknown> = {},
  ): Promise<ChallengeDto> {
    const response = await client.post('/api/challenges', {
      title: '30 дней без доставки',
      kind: 'no_spend_category',
      durationDays: 30,
      visibility: 'private',
      ...body,
    });
    expect(response.status).toBe(201);
    return response.body as ChallengeDto;
  }

  describe('создание и состав (ТЗ §4)', () => {
    it('ведущий создаёт челлендж, сам вступает и получает код', async () => {
      const a = await signUp('ch-a@example.com', 'chal');
      const challenge = await createChallenge(a);
      expect(challenge.inviteCode.startsWith('CH-')).toBe(true);
      expect(challenge).toMatchObject({
        isOwner: true,
        isParticipating: true,
        participantsCount: 1,
        heldDays: 0,
        percent: 0,
      });
      expect((await a.get('/api/challenges')).body.challenges).toHaveLength(1);
    });

    it('второй пользователь вступает по коду и видит состав', async () => {
      const a = await signUp('ch-b1@example.com', 'chb1');
      const b = await signUp('ch-b2@example.com', 'chb2');
      const challenge = await createChallenge(a);

      const joined = await b.post('/api/challenges/join', { code: challenge.inviteCode });
      expect(joined.status).toBe(200);
      const dto = joined.body as ChallengeDto;
      expect(dto.isParticipating).toBe(true);
      expect(dto.participantsCount).toBe(2);
      expect(dto.participants.map((participant) => participant.nickname).sort()).toEqual(['chb1', 'chb2']);

      // Повторное вступление идемпотентно.
      expect((await b.post('/api/challenges/join', { code: challenge.inviteCode })).status).toBe(200);
      expect((await b.get(`/api/challenges/${challenge.id}`)).body.participantsCount).toBe(2);
    });

    it('несуществующий код приглашения — 404', async () => {
      const a = await signUp('ch-c@example.com', 'chc');
      const response = await a.post('/api/challenges/join', { code: 'CH-NOPE00' });
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('invite_not_found');
    });
  });

  describe('приватность (ТЗ §4)', () => {
    it('private-челлендж и рейтинг не видны постороннему', async () => {
      const a = await signUp('ch-p1@example.com', 'chp1');
      const b = await signUp('ch-p2@example.com', 'chp2');
      const challenge = await createChallenge(a, { visibility: 'private' });

      expect((await b.get(`/api/challenges/${challenge.id}`)).status).toBe(404);
      expect((await b.get(`/api/challenges/${challenge.id}/leaderboard`)).status).toBe(404);
    });

    it('public-челлендж виден всем, но рейтинг — только участникам', async () => {
      const a = await signUp('ch-u1@example.com', 'chu1');
      const b = await signUp('ch-u2@example.com', 'chu2');
      const challenge = await createChallenge(a, { visibility: 'public' });

      expect((await b.get(`/api/challenges/${challenge.id}`)).status).toBe(200);
      // Рейтинг доступен только участникам.
      expect((await b.get(`/api/challenges/${challenge.id}/leaderboard`)).status).toBe(404);
    });

    it('friends-челлендж виден подписчику владельца', async () => {
      const a = await signUp('ch-f1@example.com', 'chf1');
      const b = await signUp('ch-f2@example.com', 'chf2');
      const challenge = await createChallenge(a, { visibility: 'friends' });

      expect((await b.get(`/api/challenges/${challenge.id}`)).status).toBe(404);
      await b.post('/api/follows/chf1');
      expect((await b.get(`/api/challenges/${challenge.id}`)).status).toBe(200);
    });
  });

  describe('отметки и прогресс (ТЗ §4)', () => {
    it('отметка «держусь» поднимает дни выдержки и прогресс', async () => {
      const a = await signUp('ch-k1@example.com', 'chk1');
      const challenge = await createChallenge(a, { durationDays: 7 });

      const checked = await a.post(`/api/challenges/${challenge.id}/check`, { ok: true });
      expect(checked.status).toBe(201);
      const dto = checked.body as ChallengeDto;
      expect(dto).toMatchObject({ heldDays: 1, currentStreak: 1, checkedToday: true, percent: 14 });

      // Отметка «не держусь» на тот же день обнуляет день (upsert).
      const failed = await a.post(`/api/challenges/${challenge.id}/check`, { ok: false });
      expect((failed.body as ChallengeDto).heldDays).toBe(0);
    });

    it('отметка вне окна челленджа отклоняется', async () => {
      const a = await signUp('ch-k2@example.com', 'chk2');
      const challenge = await createChallenge(a, { durationDays: 7 });
      const response = await a.post(`/api/challenges/${challenge.id}/check`, {
        date: '2020-01-01',
        ok: true,
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('date_out_of_range');
    });

    it('не участник не может отметиться', async () => {
      const a = await signUp('ch-k3@example.com', 'chk3');
      const b = await signUp('ch-k4@example.com', 'chk4');
      const challenge = await createChallenge(a, { visibility: 'public' });
      expect((await b.post(`/api/challenges/${challenge.id}/check`, { ok: true })).status).toBe(404);
    });
  });

  describe('рейтинг (ТЗ §4)', () => {
    it('сортирует участников по дням выдержки и отдаёт только никнеймы и счёт', async () => {
      const a = await signUp('ch-r1@example.com', 'chr1');
      const b = await signUp('ch-r2@example.com', 'chr2');
      const challenge = await createChallenge(a, { durationDays: 30 });
      await b.post('/api/challenges/join', { code: challenge.inviteCode });

      await a.post(`/api/challenges/${challenge.id}/check`, { ok: true });
      await b.post(`/api/challenges/${challenge.id}/check`, { ok: true });

      const response = await a.get(`/api/challenges/${challenge.id}/leaderboard`);
      expect(response.status).toBe(200);
      const board = response.body as LeaderboardDto;
      expect(board.entries.map((entry) => entry.nickname).sort()).toEqual(['chr1', 'chr2']);
      expect(board.entries.map((entry) => entry.rank)).toEqual([1, 2]);
      expect(board.entries[0]).toMatchObject({ score: 1, currentStreak: 1 });
      // Только никнейм, счёт, серия и место — приватных данных нет.
      expect(Object.keys(board.entries[0]).sort()).toEqual([
        'currentStreak',
        'nickname',
        'rank',
        'score',
        'userId',
      ]);
    });
  });

  describe('приглашение из подписок (ТЗ §4)', () => {
    it('ведущий приглашает подписку, постороннего — нет', async () => {
      const a = await signUp('ch-i1@example.com', 'chi1');
      const b = await signUp('ch-i2@example.com', 'chi2');
      const c = await signUp('ch-i3@example.com', 'chi3');
      const challenge = await createChallenge(a);

      // A подписан на B, но не на C.
      await a.post('/api/follows/chi2');

      const candidates = await a.get(`/api/challenges/${challenge.id}/invite-candidates`);
      expect(candidates.status).toBe(200);
      expect(candidates.body.users).toEqual([{ userId: expect.any(String), nickname: 'chi2' }]);

      const invited = await a.post(`/api/challenges/${challenge.id}/invite`, { nickname: 'chi2' });
      expect(invited.status).toBe(201);
      expect((invited.body as ChallengeDto).participantsCount).toBe(2);

      const forbidden = await a.post(`/api/challenges/${challenge.id}/invite`, { nickname: 'chi3' });
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.code).toBe('not_following');
    });

    it('не ведущий не может приглашать и вести челлендж', async () => {
      const a = await signUp('ch-i4@example.com', 'chi4');
      const b = await signUp('ch-i5@example.com', 'chi5');
      const challenge = await createChallenge(a);
      await b.post('/api/challenges/join', { code: challenge.inviteCode });

      expect((await b.get(`/api/challenges/${challenge.id}/invite-candidates`)).status).toBe(403);
      expect((await b.put(`/api/challenges/${challenge.id}`, { title: 'Чужой' })).status).toBe(403);
      expect((await b.del(`/api/challenges/${challenge.id}`)).status).toBe(404);
    });
  });

  describe('CRUD (ТЗ §4)', () => {
    it('ведущий правит название и удаляет челлендж', async () => {
      const a = await signUp('ch-d@example.com', 'chd');
      const challenge = await createChallenge(a);

      const updated = await a.put(`/api/challenges/${challenge.id}`, {
        title: 'Неделя без импульсных покупок',
        visibility: 'public',
      });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({
        title: 'Неделя без импульсных покупок',
        visibility: 'public',
      });

      expect((await a.del(`/api/challenges/${challenge.id}`)).status).toBe(204);
      expect((await a.get(`/api/challenges/${challenge.id}`)).status).toBe(404);
      expect((await a.get('/api/challenges')).body.challenges).toHaveLength(0);
    });
  });
});
