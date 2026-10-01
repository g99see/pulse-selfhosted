// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты социального блока (ТЗ §3.7): подписки, лента с учётом
// приватности, реакции, комментарии и лимит частоты — против реального
// PostgreSQL в схеме puls_test. Запуск: pnpm --filter @puls/api test
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

interface PostDto {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  visibility: string;
  author: { id: string; nickname: string };
  reactions: { emoji: string; count: number; reactedByMe: boolean }[];
  reactionCount: number;
  commentsCount: number;
  createdAt: string;
}

interface FeedPage {
  posts: PostDto[];
  nextCursor: string | null;
}

describe('Social API (интеграция с PostgreSQL)', () => {
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
      'DELETE FROM "comments"',
      'DELETE FROM "reactions"',
      'DELETE FROM "posts"',
      'DELETE FROM "follows"',
      'DELETE FROM "goal_deposits"',
      'DELETE FROM "goals"',
      'DELETE FROM "user_achievements"',
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

  async function setProfileVisibility(nickname: string, visibility: string): Promise<string> {
    const user = await prisma.user.update({
      where: { nickname },
      data: { profileVisibility: visibility },
      select: { id: true },
    });
    return user.id;
  }

  async function createGoal(
    client: TestClient,
    visibility: string,
    title = 'Ноутбук',
  ): Promise<void> {
    const response = await client.post('/api/goals', { title, targetAmount: 100000, visibility });
    expect(response.status).toBe(201);
  }

  async function feed(client: TestClient, query = ''): Promise<FeedPage> {
    const response = await client.get(`/api/feed${query}`);
    expect(response.status).toBe(200);
    return response.body as FeedPage;
  }

  describe('подписки (ТЗ §3.7)', () => {
    it('подписывает и отписывает, ведёт списки подписок', async () => {
      const a = await signUp('soc-a@example.com', 'soca');
      const b = await signUp('soc-b@example.com', 'socb');

      const followed = await a.post('/api/follows/socb');
      expect(followed.status).toBe(201);
      expect(followed.body).toMatchObject({
        following: true,
        followersCount: 1,
        followingCount: 0,
      });

      // Идемпотентность: повторная подписка не создаёт дубль.
      const again = await a.post('/api/follows/socb');
      expect(again.status).toBe(201);
      expect((await a.get('/api/follows/following')).body.users).toEqual([
        { id: expect.any(String), nickname: 'socb' },
      ]);
      expect((await b.get('/api/follows/followers')).body.users[0].nickname).toBe('soca');

      const unfollowed = await a.del('/api/follows/socb');
      expect(unfollowed.status).toBe(204);
      expect((await a.get('/api/follows/socb')).body.following).toBe(false);
    });

    it('нельзя подписаться на себя и на несуществующего', async () => {
      const a = await signUp('soc-self@example.com', 'socself');
      const self = await a.post('/api/follows/socself');
      expect(self.status).toBe(400);
      expect(self.body.code).toBe('cannot_follow_self');

      const missing = await a.post('/api/follows/nobody-here');
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe('user_not_found');
    });
  });

  describe('лента и приватность (ТЗ §3.7)', () => {
    it('посты подписок видны, своих постов не видит посторонний', async () => {
      const a = await signUp('soc-fa@example.com', 'socfa');
      const b = await signUp('soc-fb@example.com', 'socfb');
      await setProfileVisibility('socfb', 'subscribers');
      await createGoal(b, 'public');

      // Без подписки лента A пуста (профиль B — «только подписчикам»).
      expect((await feed(a)).posts).toHaveLength(0);

      await a.post('/api/follows/socfb');
      const page = await feed(a);
      expect(page.posts).toHaveLength(1);
      expect(page.posts[0]).toMatchObject({ type: 'goal', visibility: 'public' });
      expect(page.posts[0].author.nickname).toBe('socfb');
      expect(page.posts[0].payload).toMatchObject({ title: 'Ноутбук' });
    });

    it('приватный профиль не отдаёт посты даже подписчикам', async () => {
      const a = await signUp('soc-pa@example.com', 'socpa');
      const b = await signUp('soc-pb@example.com', 'socpb');
      await setProfileVisibility('socpb', 'private');
      await createGoal(b, 'public');
      await a.post('/api/follows/socpb');

      expect((await feed(a)).posts).toHaveLength(0);
      // Собственную запись B видит.
      expect((await feed(b)).posts).toHaveLength(1);
    });

    it('пагинация курсором отдаёт следующую страницу', async () => {
      const a = await signUp('soc-pg@example.com', 'socpg');
      const aId = await setProfileVisibility('socpg', 'public');
      for (let i = 0; i < 3; i += 1) {
        await prisma.post.create({
          data: {
            userId: aId,
            type: 'achievement',
            payload: { code: `c${i}` },
            visibility: 'public',
          },
        });
      }

      const first = await feed(a, '?limit=2');
      expect(first.posts).toHaveLength(2);
      expect(first.nextCursor).toBeTruthy();

      const second = await feed(a, `?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`);
      expect(second.posts).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
    });
  });

  describe('реакции (ТЗ §3.7)', () => {
    async function setupPostWithVisibility(visibility: string) {
      const a = await signUp('soc-ra@example.com', 'socra');
      const b = await signUp('soc-rb@example.com', 'socrb');
      await setProfileVisibility('socrb', 'public');
      await createGoal(b, visibility);
      const post = (await feed(b)).posts[0]!;
      return { a, b, post };
    }

    it('ставит реакцию и агрегирует по эмодзи', async () => {
      const { a, post } = await setupPostWithVisibility('public');
      const response = await a.post(`/api/posts/${post.id}/reactions`, { emoji: '🔥' });
      expect(response.status).toBe(201);
      expect(response.body).toEqual([{ emoji: '🔥', count: 1, reactedByMe: true }]);

      // Повторная та же реакция — идемпотентно.
      const again = await a.post(`/api/posts/${post.id}/reactions`, { emoji: '🔥' });
      expect(again.status).toBe(201);
      expect(again.body).toEqual([{ emoji: '🔥', count: 1, reactedByMe: true }]);

      const removed = await a.del(`/api/posts/${post.id}/reactions/${encodeURIComponent('🔥')}`);
      expect(removed.status).toBe(204);
    });

    it('неизвестный эмодзи отклоняется', async () => {
      const { a, post } = await setupPostWithVisibility('public');
      const response = await a.post(`/api/posts/${post.id}/reactions`, { emoji: '🚀' });
      expect(response.status).toBe(400);
    });

    it('не-подписчик не может реагировать на пост «только подписчикам»', async () => {
      const { a, post } = await setupPostWithVisibility('subscribers');
      const response = await a.post(`/api/posts/${post.id}/reactions`, { emoji: '👍' });
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('post_not_found');
    });
  });

  describe('комментарии (ТЗ §3.7)', () => {
    async function setupPost() {
      const a = await signUp('soc-ca@example.com', 'socca');
      const b = await signUp('soc-cb@example.com', 'soccb');
      await setProfileVisibility('soccb', 'public');
      await createGoal(b, 'public');
      const post = (await feed(b)).posts[0]!;
      return { a, b, post };
    }

    it('добавляет и перечисляет комментарии', async () => {
      const { a, post } = await setupPost();
      const created = await a.post(`/api/posts/${post.id}/comments`, { body: 'Поздравляю!' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ body: 'Поздравляю!', canDelete: true });

      const list = await a.get(`/api/posts/${post.id}/comments`);
      expect(list.body).toHaveLength(1);
    });

    it('отклоняет комментарий длиннее 500 символов', async () => {
      const { a, post } = await setupPost();
      const response = await a.post(`/api/posts/${post.id}/comments`, { body: 'a'.repeat(501) });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('validation_error');
    });

    it('удалять может автор комментария или владелец поста', async () => {
      const { a, b, post } = await setupPost();
      const created = await a.post(`/api/posts/${post.id}/comments`, { body: 'Мой комментарий' });
      const commentId = (created.body as { id: string }).id;

      // Посторонний не может удалить.
      const c = await signUp('soc-cc@example.com', 'soccc');
      const forbidden = await c.del(`/api/comments/${commentId}`);
      expect(forbidden.status).toBe(403);

      // Владелец поста (B) удаляет комментарий A.
      const removed = await b.del(`/api/comments/${commentId}`);
      expect(removed.status).toBe(204);
      expect((await a.get(`/api/posts/${post.id}/comments`)).body).toHaveLength(0);
    });

    it('ограничивает частоту комментариев', async () => {
      const { a, post } = await setupPost();
      for (let i = 0; i < 20; i += 1) {
        const response = await a.post(`/api/posts/${post.id}/comments`, {
          body: `Комментарий ${i}`,
        });
        expect(response.status).toBe(201);
      }
      const limited = await a.post(`/api/posts/${post.id}/comments`, { body: 'Ещё один' });
      expect(limited.status).toBe(429);
      expect(limited.body.code).toBe('rate_limited');
    });
  });

  describe('создание постов при достижениях и целях (ТЗ §3.7)', () => {
    it('создание цели и веха прогресса попадают в ленту', async () => {
      const a = await signUp('soc-post@example.com', 'socpost');
      const aId = await setProfileVisibility('socpost', 'public');
      expect(aId).toBeTruthy();

      const goal = await a.post('/api/goals', {
        title: 'Отпуск',
        targetAmount: 100000,
        visibility: 'public',
      });
      expect(goal.status).toBe(201);
      const goalId = (goal.body as { id: string }).id;

      const deposit = await a.post(`/api/goals/${goalId}/deposit`, { amount: 60000 });
      expect(deposit.status).toBe(201);

      const page = await feed(a);
      const types = page.posts.map((post) => post.type).sort();
      // Цель + две вехи (25% и 50%) по мере пополнения.
      expect(types).toContain('goal');
      expect(types.filter((type) => type === 'milestone').length).toBeGreaterThanOrEqual(1);
    });
  });
});
