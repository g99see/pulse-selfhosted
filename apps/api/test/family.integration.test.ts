// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты семейного режима (ТЗ §4) против реального PostgreSQL в
// схеме puls_test: создание семьи и приглашения, роли, общие счета и операции,
// общие цели и взносы, кросс-семейная изоляция и главный инвариант — участник
// семьи не видит личных данных другого участника.
// Запуск: pnpm --filter @puls/api exec vitest run test/family.integration.test.ts
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

interface FamilyDto {
  id: string;
  name: string;
  ownerId: string;
  role: string;
  members: Array<{ userId: string; nickname: string; role: string }>;
}

interface FamilyAccountDto {
  id: string;
  name: string;
  type: string;
  balance: number;
  currency: string;
}

interface FamilyGoalDto {
  id: string;
  title: string;
  targetAmount: number;
  savedAmount: number;
  percent: number;
  remaining: number;
  requiredMonthly: number | null;
  milestones: number[];
  deposits: Array<{ amount: number; userId: string }>;
}

describe('Family API (интеграция с PostgreSQL)', () => {
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
      'DELETE FROM "family_goal_deposits"',
      'DELETE FROM "family_goals"',
      'DELETE FROM "family_transactions"',
      'DELETE FROM "family_accounts"',
      'DELETE FROM "family_invites"',
      'DELETE FROM "family_members"',
      'DELETE FROM "families"',
      'DELETE FROM "goal_deposits"',
      'DELETE FROM "goals"',
      'DELETE FROM "transactions"',
      'DELETE FROM "budgets"',
      'DELETE FROM "categories" WHERE "user_id" IS NOT NULL',
      'DELETE FROM "accounts"',
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

  async function createFamily(client: TestClient, name = 'Дом'): Promise<FamilyDto> {
    const response = await client.post('/api/family', { name });
    expect(response.status).toBe(201);
    return response.body as FamilyDto;
  }

  async function invite(client: TestClient): Promise<string> {
    const response = await client.post('/api/family/invites', {});
    expect(response.status).toBe(201);
    return (response.body as { code: string }).code;
  }

  describe('Семья и приглашения (ТЗ §4)', () => {
    it('создаёт семью: создатель — владелец и участник', async () => {
      const owner = await signUp('fam-owner@example.com', 'famowner');
      const family = await createFamily(owner, 'Наш дом');

      expect(family).toMatchObject({ name: 'Наш дом', role: 'owner' });
      expect(family.members).toHaveLength(1);
      expect(family.members[0]).toMatchObject({ nickname: 'famowner', role: 'owner' });

      const me = await owner.get('/api/family');
      expect(me.status).toBe(200);
      expect((me.body.family as FamilyDto).id).toBe(family.id);
    });

    it('второй участник вступает по одноразовому коду', async () => {
      const owner = await signUp('fam-owner2@example.com', 'famowner2');
      const member = await signUp('fam-member2@example.com', 'fammember2');
      await createFamily(owner);
      const code = await invite(owner);

      const joined = await member.post('/api/family/join', { code });
      expect(joined.status).toBe(200);
      expect((joined.body as FamilyDto).role).toBe('member');
      expect((joined.body as FamilyDto).members).toHaveLength(2);

      // Код одноразовый: повторное вступление отклоняется.
      const third = await signUp('fam-third2@example.com', 'famthird2');
      expect((await third.post('/api/family/join', { code })).status).toBe(404);

      // Один пользователь — одна семья: повторное создание/вступление отклоняется.
      expect((await member.post('/api/family', { name: 'Ещё' })).status).toBe(409);
      expect((await member.post('/api/family/join', { code: 'FAM-NOPE' })).status).toBe(409);
    });

    it('без семьи GET /api/family отдаёт null, а не 404', async () => {
      const solo = await signUp('fam-solo@example.com', 'famsolo');
      const response = await solo.get('/api/family');
      expect(response.status).toBe(200);
      expect(response.body.family).toBeNull();
    });

    it('составом управляет владелец: участник не может приглашать и удалять', async () => {
      const owner = await signUp('fam-owner3@example.com', 'famowner3');
      const member = await signUp('fam-member3@example.com', 'fammember3');
      await createFamily(owner);
      await member.post('/api/family/join', { code: await invite(owner) });

      expect((await member.post('/api/family/invites', {})).status).toBe(403);
      const family = (await owner.get('/api/family')).body.family as FamilyDto;
      expect((await member.del(`/api/family/members/${family.ownerId}`)).status).toBe(403);
      expect((await member.del('/api/family')).status).toBe(403);
    });

    it('владелец исключает участника, участник может выйти сам', async () => {
      const owner = await signUp('fam-owner4@example.com', 'famowner4');
      const member = await signUp('fam-member4@example.com', 'fammember4');
      const family = await createFamily(owner);
      await member.post('/api/family/join', { code: await invite(owner) });

      const members = (await owner.get('/api/family')).body.family.members as FamilyDto['members'];
      const memberRow = members.find((row) => row.nickname === 'fammember4')!;
      expect((await owner.del(`/api/family/members/${memberRow.userId}`)).status).toBe(204);
      expect((await owner.get('/api/family')).body.family.members).toHaveLength(1);

      // Повторно вступает и выходит сам.
      await member.post('/api/family/join', { code: await invite(owner) });
      expect((await member.post('/api/family/leave', {})).status).toBe(204);
      expect((await member.get('/api/family')).body.family).toBeNull();
      expect((await owner.get('/api/family')).body.family.members).toHaveLength(1);
      expect(family.id).toBeTruthy();
    });

    it('владелец не может выйти — только удалить семью', async () => {
      const owner = await signUp('fam-owner5@example.com', 'famowner5');
      await createFamily(owner);
      expect((await owner.post('/api/family/leave', {})).status).toBe(409);
      expect((await owner.del('/api/family')).status).toBe(204);
      expect((await owner.get('/api/family')).body.family).toBeNull();
    });

    it('без сессии — 401', async () => {
      const anon = new TestClient(server);
      expect((await anon.get('/api/family')).status).toBe(401);
      // На мутирующий запрос без cookie CSRF-защита отвечает раньше сессии.
      expect((await anon.post('/api/family', { name: 'X' })).status).toBe(403);
    });
  });

  describe('Общие счета и операции (ТЗ §4)', () => {
    it('создаёт общий счёт, вносит доход и расход, баланс пересчитывается', async () => {
      const owner = await signUp('fam-acc@example.com', 'famacc');
      await createFamily(owner);

      const created = await owner.post('/api/family/accounts', {
        name: 'Общий',
        type: 'card',
        balance: 1000,
      });
      expect(created.status).toBe(201);
      const account = created.body as FamilyAccountDto;
      expect(account).toMatchObject({ name: 'Общий', type: 'card', balance: 1000 });

      const income = await owner.post(`/api/family/accounts/${account.id}/transactions`, {
        kind: 'income',
        amount: 5000,
        note: 'Зарплата',
      });
      expect(income.status).toBe(201);
      expect(income.body.account.balance).toBe(6000);
      expect(income.body.transaction).toMatchObject({
        kind: 'income',
        amount: 5000,
        note: 'Зарплата',
      });

      const expense = await owner.post(`/api/family/accounts/${account.id}/transactions`, {
        kind: 'expense',
        amount: 1500,
      });
      expect(expense.body.account.balance).toBe(4500);

      const list = await owner.get('/api/family/accounts');
      expect(list.body.accounts).toHaveLength(1);
      expect(list.body.accounts[0].balance).toBe(4500);
      expect(list.body.totalBalance).toBe(4500);

      const transactions = await owner.get(`/api/family/accounts/${account.id}/transactions`);
      expect(transactions.body.transactions).toHaveLength(2);
      expect(transactions.body.transactions[0].kind).toBe('expense');
    });

    it('участник тоже вносит операции, но чужой счёт недоступен', async () => {
      const owner = await signUp('fam-acc2@example.com', 'famacc2');
      const member = await signUp('fam-acc2m@example.com', 'famacc2m');
      await createFamily(owner);
      const account = (await owner.post('/api/family/accounts', { name: 'Общий' }))
        .body as FamilyAccountDto;

      const outsider = await signUp('fam-acc3@example.com', 'famacc3');
      await createFamily(outsider, 'Другая');
      expect((await outsider.get(`/api/family/accounts/${account.id}/transactions`)).status).toBe(
        404,
      );
      expect(
        (
          await outsider.post(`/api/family/accounts/${account.id}/transactions`, {
            kind: 'income',
            amount: 1,
          })
        ).status,
      ).toBe(404);

      await member.post('/api/family/join', { code: await invite(owner) });
      const contributed = await member.post(`/api/family/accounts/${account.id}/transactions`, {
        kind: 'income',
        amount: 2000,
      });
      expect(contributed.status).toBe(201);
      expect(contributed.body.transaction.userId).toBeTruthy();
      expect(contributed.body.account.balance).toBe(2000);

      expect(
        (await owner.put(`/api/family/accounts/${account.id}`, { name: 'Общий+', balance: 3000 }))
          .status,
      ).toBe(200);
      expect((await owner.del(`/api/family/accounts/${account.id}`)).status).toBe(204);
    });
  });

  describe('Общие цели и взносы (ТЗ §4)', () => {
    it('создаёт общую цель, взносы участников дают прогресс и вехи', async () => {
      const owner = await signUp('fam-goal@example.com', 'famgoal');
      const member = await signUp('fam-goal-m@example.com', 'famgoalm');
      await createFamily(owner);
      await member.post('/api/family/join', { code: await invite(owner) });

      const created = await owner.post('/api/family/goals', {
        title: 'Ремонт',
        targetAmount: 200000,
        deadline: '2027-06-01',
      });
      expect(created.status).toBe(201);
      const goal = created.body as FamilyGoalDto;
      expect(goal).toMatchObject({ title: 'Ремонт', targetAmount: 200000, percent: 0 });
      expect(goal.requiredMonthly).toBeGreaterThan(0);

      const first = await member.post(`/api/family/goals/${goal.id}/deposit`, { amount: 100000 });
      expect(first.status).toBe(201);
      expect(first.body.goal).toMatchObject({
        savedAmount: 100000,
        percent: 50,
        remaining: 100000,
      });
      expect(first.body.goal.milestones).toEqual([25, 50]);
      expect(first.body.goal.deposits).toHaveLength(1);

      const second = await owner.post(`/api/family/goals/${goal.id}/deposit`, { amount: 50000 });
      expect(second.body.goal.percent).toBe(75);

      const goals = await member.get('/api/family/goals');
      expect(goals.body.goals).toHaveLength(1);
      expect(goals.body.goals[0].savedAmount).toBe(150000);

      expect(
        (await owner.put(`/api/family/goals/${goal.id}`, { targetAmount: 300000 })).status,
      ).toBe(200);
      expect((await owner.del(`/api/family/goals/${goal.id}`)).status).toBe(204);
    });

    it('чужая семейная цель не видна и не пополняется (404)', async () => {
      const owner = await signUp('fam-goal2@example.com', 'famgoal2');
      const outsider = await signUp('fam-goal3@example.com', 'famgoal3');
      await createFamily(owner);
      await createFamily(outsider, 'Другая');
      const goal = (await owner.post('/api/family/goals', { title: 'Цель', targetAmount: 1000 }))
        .body as FamilyGoalDto;

      expect((await outsider.get('/api/family/goals')).body.goals).toHaveLength(0);
      expect(
        (await outsider.post(`/api/family/goals/${goal.id}/deposit`, { amount: 100 })).status,
      ).toBe(404);
      expect((await outsider.put(`/api/family/goals/${goal.id}`, { title: 'Взлом' })).status).toBe(
        404,
      );
      expect((await outsider.del(`/api/family/goals/${goal.id}`)).status).toBe(404);
    });
  });

  describe('Приватность дневника — жёсткий инвариант (ТЗ §4, §7)', () => {
    it('участник семьи не может прочитать личные данные другого ни одним эндпоинтом', async () => {
      const alice = await signUp('fam-alice@example.com', 'famalice');
      const bob = await signUp('fam-bob@example.com', 'fambob');
      await createFamily(alice);
      await bob.post('/api/family/join', { code: await invite(alice) });

      // Личный дневник и личные финансы Алисы.
      const checkin = await alice.post('/api/checkins', { mood: 4, note: 'Личная заметка Алисы' });
      expect(checkin.status).toBe(201);
      const goal = await alice.post('/api/goals', {
        title: 'Личная цель Алисы',
        targetAmount: 50000,
      });
      expect(goal.status).toBe(201);
      const account = await alice.post('/api/finance/accounts', {
        name: 'Личный счёт Алисы',
        type: 'card',
        balance: 9999,
      });
      expect(account.status).toBe(201);

      // Боб — в той же семье, но личные данные Алисы ему не видны НИГДЕ.
      const bobCheckins = await bob.get('/api/checkins');
      expect(bobCheckins.status).toBe(200);
      expect(JSON.stringify(bobCheckins.body)).not.toContain('Личная заметка Алисы');
      expect(bobCheckins.body.checkIns).toHaveLength(0);
      expect((await bob.get(`/api/checkins/${(checkin.body as { id: string }).id}`)).status).toBe(
        404,
      );

      expect((await bob.get('/api/goals')).body.goals).toHaveLength(0);
      expect((await bob.get(`/api/goals/${(goal.body as { id: string }).id}`)).status).toBe(404);

      expect((await bob.get('/api/finance/accounts')).body.accounts).toHaveLength(0);
      expect((await bob.get('/api/finance/overview')).body.accounts).toHaveLength(0);

      // Общие данные семьи доступны, но личные — нет: разделение соблюдено.
      expect((await bob.get('/api/family')).body.family.role).toBe('member');
      expect((await alice.get('/api/checkins')).body.checkIns).toHaveLength(1);
    });
  });
});
