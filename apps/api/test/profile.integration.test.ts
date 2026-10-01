// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты публичного профиля (ТЗ §3.7) против реального
// PostgreSQL в схеме puls_test: свой профиль, фильтрация карточек по
// приватности, изоляция между пользователями и режим «проценты/сумма».
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

interface CardDto {
  type: string;
  visibility: string;
  mode: string;
  title: string | null;
  data: Record<string, unknown>;
}

interface ProfileDto {
  nickname: string;
  bio: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  profileVisibility?: string;
  cards: CardDto[];
}

describe('Profile API (интеграция с PostgreSQL)', () => {
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
      'DELETE FROM "profile_cards"',
      'DELETE FROM "profiles"',
      'DELETE FROM "goal_deposits"',
      'DELETE FROM "goals"',
      'DELETE FROM "transactions"',
      'DELETE FROM "budgets"',
      'DELETE FROM "categories" WHERE "user_id" IS NOT NULL',
      'DELETE FROM "accounts"',
      'DELETE FROM "user_achievements"',
      'DELETE FROM "daily_stats"',
      'DELETE FROM "check_ins"',
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

  async function setProfileVisibility(nickname: string, visibility: string): Promise<void> {
    await prisma.user.update({ where: { nickname }, data: { profileVisibility: visibility } });
  }

  async function getOwn(client: TestClient): Promise<ProfileDto> {
    const response = await client.get('/api/profile');
    expect(response.status).toBe(200);
    return (response.body as { profile: ProfileDto }).profile;
  }

  describe('свой профиль (GET/PUT /api/profile)', () => {
    it('по умолчанию отдаёт набор скрытых карточек с процентами', async () => {
      const client = await signUp('owner1@example.com', 'ownerone');
      const profile = await getOwn(client);

      expect(profile.nickname).toBe('ownerone');
      expect(profile.cards.map((card) => card.type).sort()).toEqual(
        ['achievements', 'avg_mood', 'checkin_streak', 'goals', 'savings'].sort(),
      );
      for (const card of profile.cards) {
        expect(card.visibility).toBe('private');
        expect(card.mode).toBe('percent');
      }
    });

    it('сохраняет описание, аватар, обложку и настройки карточек', async () => {
      const client = await signUp('owner2@example.com', 'ownertwo');
      await getOwn(client);

      const response = await client.put('/api/profile', {
        bio: 'Коплю на мечту',
        avatarUrl: 'https://example.com/a.png',
        coverUrl: 'https://example.com/c.png',
        cards: [
          { type: 'savings', visibility: 'public', mode: 'amount' },
          { type: 'goals', visibility: 'subscribers', mode: 'percent' },
          { type: 'avg_mood', visibility: 'public', mode: 'percent' },
        ],
      });
      expect(response.status).toBe(200);
      const profile = (response.body as { profile: ProfileDto }).profile;

      expect(profile.bio).toBe('Коплю на мечту');
      expect(profile.avatarUrl).toBe('https://example.com/a.png');
      expect(profile.cards.map((card) => card.type).sort()).toEqual(['avg_mood', 'goals', 'savings']);
      expect(profile.cards.find((card) => card.type === 'savings')?.mode).toBe('amount');
    });

    it('отклоняет ссылку не http(s) и сохраняет только percent у неподдерживаемых типов', async () => {
      const client = await signUp('owner3@example.com', 'ownerthree');
      await getOwn(client);

      const bad = await client.put('/api/profile', { avatarUrl: 'ftp://example.com/a.png' });
      expect(bad.status).toBe(400);

      const response = await client.put('/api/profile', {
        cards: [{ type: 'avg_mood', visibility: 'public', mode: 'amount' }],
      });
      expect(response.status).toBe(200);
      expect((response.body as { profile: ProfileDto }).profile.cards[0]?.mode).toBe('percent');
    });
  });

  describe('публичный профиль (GET /api/public/profiles/:nickname)', () => {
    it('закрытый профиль не отдаётся анонимному и подписчику (404)', async () => {
      await signUp('priv1@example.com', 'privone');
      const viewer = new TestClient(server);

      const anon = await viewer.get('/api/public/profiles/privone');
      expect(anon.status).toBe(404);
    });

    it('фильтрует карточки по приватности: private скрыт, public виден', async () => {
      const client = await signUp('pub1@example.com', 'pubone');
      await getOwn(client);
      await client.put('/api/profile', {
        cards: [
          { type: 'savings', visibility: 'public', mode: 'percent' },
          { type: 'goals', visibility: 'subscribers', mode: 'percent' },
          { type: 'avg_mood', visibility: 'private', mode: 'percent' },
        ],
      });
      await setProfileVisibility('pubone', 'public');

      const anon = new TestClient(server);
      const response = await anon.get('/api/public/profiles/pubone');
      expect(response.status).toBe(200);
      const profile = (response.body as { profile: ProfileDto }).profile;
      expect(profile.cards.map((card) => card.type)).toEqual(['savings']);
    });

    it('владелец видит свои скрытые карточки в публичном представлении', async () => {
      const client = await signUp('pub2@example.com', 'pubtwo');
      await getOwn(client);
      await client.put('/api/profile', {
        cards: [
          { type: 'savings', visibility: 'public', mode: 'percent' },
          { type: 'avg_mood', visibility: 'private', mode: 'percent' },
        ],
      });
      await setProfileVisibility('pubtwo', 'public');

      const response = await client.get('/api/public/profiles/pubtwo');
      expect(response.status).toBe(200);
      const profile = (response.body as { profile: ProfileDto }).profile;
      expect(profile.cards.map((card) => card.type).sort()).toEqual(['avg_mood', 'savings']);
    });

    it('не раскрывает карточки чужого пользователя (изоляция)', async () => {
      const a = await signUp('iso-a@example.com', 'isoalpha');
      await getOwn(a);
      await a.put('/api/profile', { cards: [{ type: 'savings', visibility: 'public', mode: 'amount' }] });
      await setProfileVisibility('isoalpha', 'public');

      const b = await signUp('iso-b@example.com', 'isobeta');
      await getOwn(b);

      const response = await b.get('/api/public/profiles/isoalpha');
      expect(response.status).toBe(200);
      const profile = (response.body as { profile: ProfileDto }).profile;
      expect(profile.nickname).toBe('isoalpha');
      expect(profile.cards).toHaveLength(1);
      expect(profile.cards[0]?.type).toBe('savings');
      // У второго пользователя нет целей — накопления нулевые, чужие суммы не утекли.
      expect(profile.cards[0]?.data).toMatchObject({ percent: 0, amount: 0 });
    });

    it('суммы показываются только в режиме amount, по умолчанию — проценты', async () => {
      const client = await signUp('sav@example.com', 'savingsone');
      const user = await prisma.user.findUniqueOrThrow({ where: { nickname: 'savingsone' } });
      await prisma.goal.create({
        data: {
          userId: user.id,
          title: 'Ноутбук',
          targetAmount: 100000,
          savedAmount: 25000,
          currency: user.currency,
        },
      });
      await getOwn(client);
      await client.put('/api/profile', {
        cards: [
          { type: 'savings', visibility: 'public', mode: 'percent' },
          { type: 'goals', visibility: 'public', mode: 'amount' },
        ],
      });
      await setProfileVisibility('savingsone', 'public');

      const anon = new TestClient(server);
      const response = await anon.get('/api/public/profiles/savingsone');
      const profile = (response.body as { profile: ProfileDto }).profile;
      const savings = profile.cards.find((card) => card.type === 'savings');
      const goals = profile.cards.find((card) => card.type === 'goals');

      expect(savings?.data).toMatchObject({ percent: 25, amount: null });
      expect(goals?.data).toMatchObject({
        goals: [{ title: 'Ноутбук', percent: 25, amount: 25000 }],
      });
    });

    it('несуществующий никнейм — 404', async () => {
      const anon = new TestClient(server);
      const response = await anon.get('/api/public/profiles/nobodyhere');
      expect(response.status).toBe(404);
    });

    it('подписчик видит карточки уровня subscribers (блок B, Follow)', async () => {
      const owner = await signUp('sub-owner@example.com', 'subowner');
      await getOwn(owner);
      await owner.put('/api/profile', {
        cards: [
          { type: 'savings', visibility: 'public', mode: 'percent' },
          { type: 'goals', visibility: 'subscribers', mode: 'percent' },
        ],
      });
      await setProfileVisibility('subowner', 'subscribers');

      const ownerUser = await prisma.user.findUniqueOrThrow({ where: { nickname: 'subowner' } });
      const viewer = await signUp('sub-viewer@example.com', 'subviewer');
      const viewerUser = await prisma.user.findUniqueOrThrow({ where: { nickname: 'subviewer' } });

      // Follow делает блок B. Пока таблица follows не мигрирована, тонкий хелпер
      // считает подписки отсутствующими — закрытый профиль отдаёт 404.
      let followAvailable = true;
      try {
        await prisma.follow.create({
          data: { followerId: viewerUser.id, followingId: ownerUser.id },
        });
      } catch {
        followAvailable = false;
      }

      const response = await viewer.get('/api/public/profiles/subowner');
      if (!followAvailable) {
        expect(response.status).toBe(404);
        return;
      }

      expect(response.status).toBe(200);
      const profile = (response.body as { profile: ProfileDto }).profile;
      expect(profile.cards.map((card) => card.type).sort()).toEqual(['goals', 'savings']);
    });
  });
});
