// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Демо-данные «Пульса» (одна команда, идемпотентно).
 *
 * Запуск:  node scripts/demo/seed.mjs
 * (или через dev-run.sh / systemd — окружение подхватывается автоматически).
 *
 * Что делает скрипт:
 *   1. Находит или создаёт демо-пользователя `demo@puls.local` (ник `demo`) с
 *      подтверждённым email и пройденным онбордингом, и второго пользователя
 *      `friend@puls.local` (ник `friend`) — для подписки и семьи.
 *   2. Наполняет ~90 дней правдоподобными данными прямо по схеме Prisma
 *      (счета, транзакции, бюджеты, чек-ины, цели, привычки, регулярный платёж,
 *      достижения, профиль с карточками, HTML-страница, пост в ленте, челлендж,
 *      капсула времени, семья).
 *   3. Пробует дёрнуть живой API демо-сессией, чтобы ленивые сервисы
 *      (достижения/стрик, дневные агрегаты) отработали, — если API недоступен,
 *      это не ошибка.
 *
 * Идемпотентность: перед наполнением удаляются оба пользователя (каскадом
 * уходит всё их содержимое), затем создаются заново. Пароли сохраняются в
 * `~/.config/puls/demo-credentials` (права 600) и переиспользуются при повторных
 * запусках — в репозиторий ничего не пишется.
 */

import { createRequire } from 'node:module';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

// @prisma/client и argon2 лежат в apps/api/node_modules — берём оттуда.
const requireApi = createRequire(join(REPO_ROOT, 'apps/api', 'package.json'));
const { PrismaClient } = requireApi('@prisma/client');
const argon2 = requireApi('argon2');

const DEMO = { email: 'demo@puls.local', nickname: 'demo' };
const FRIEND = { email: 'friend@puls.local', nickname: 'friend' };
const CRED_PATH = join(homedir(), '.config', 'puls', 'demo-credentials');

/** Разбор простого файла вида `export KEY=value` (.env, puls/env). */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

// Окружение: сначала явное (уже экспортированное), затем `.env` в корне
// репозитория, затем ~/.config/puls/env.
if (!process.env.DATABASE_URL) loadEnvFile(join(REPO_ROOT, '.env'));
if (!process.env.DATABASE_URL) loadEnvFile(join(homedir(), '.config', 'puls', 'env'));

if (!process.env.DATABASE_URL) {
  console.error('Не задан DATABASE_URL (ни в окружении, ни в .env, ни в ~/.config/puls/env).');
  process.exit(1);
}

/* ---------- даты ---------- */

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}
function atHour(date, hourUtc) {
  return new Date(date.getTime() + hourUtc * 60 * 60 * 1000);
}
function monthKey(date) {
  return date.toISOString().slice(0, 7);
}
function round2(value) {
  return Math.round(value * 100) / 100;
}

const TODAY = utcDay(new Date());

/* ---------- генератор псевдослучайных (детерминированный) ---------- */

let seed = 20261001;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick(list) {
  return list[Math.floor(rnd() * list.length)];
}
function between(min, max) {
  return Math.round((min + rnd() * (max - min)) * 100) / 100;
}

/* ---------- безопасность (формат SecretBox, см. crypto/secret-box.ts) ---------- */

function masterKeyBase64() {
  if (process.env.APP_ENCRYPTION_KEY?.trim()) return process.env.APP_ENCRYPTION_KEY.trim();
  // Для dev/демо — тот же детерминированный ключ, что в secret-box.ts.
  return createHash('sha256').update('puls-insecure-development-only-2fa-key').digest('base64');
}

/** Шифрует строку в формат `v1.<iv>.<tag>.<ciphertext>` (AES-256-GCM). */
function secretBoxEncrypt(plaintext) {
  const key = Buffer.from(masterKeyBase64(), 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    data.toString('base64url'),
  ].join('.');
}

/* ---------- системные категории (совпадают с миграцией/сервисом) ---------- */

const SYSTEM_CATEGORIES = [
  ['sys-food', 'Еда', 'utensils', '#2BA889', 'expense'],
  ['sys-transport', 'Транспорт', 'bus', '#5B5BD6', 'expense'],
  ['sys-housing', 'Жильё', 'house', '#F2A25C', 'expense'],
  ['sys-entertainment', 'Развлечения', 'party-popper', '#E5484D', 'expense'],
  ['sys-health', 'Здоровье', 'heart-pulse', '#E5484D', 'expense'],
  ['sys-subscriptions', 'Подписки', 'repeat', '#5B5BD6', 'expense'],
  ['sys-shopping', 'Покупки', 'shopping-bag', '#2BA889', 'expense'],
  ['sys-connectivity', 'Связь', 'smartphone', '#6E6E7A', 'expense'],
  ['sys-other', 'Прочее', 'circle-ellipsis', '#6E6E7A', 'expense'],
  ['sys-salary', 'Зарплата', 'banknote', '#2BA889', 'income'],
  ['sys-other-income', 'Прочий доход', 'plus', '#2BA889', 'income'],
];

/* ---------- учётные данные ---------- */

function loadCredentials() {
  try {
    const parsed = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
    if (parsed?.demo?.password && parsed?.friend?.password) return parsed;
  } catch {
    /* нет файла или битый — сгенерируем заново */
  }
  return null;
}

function randomPassword() {
  return randomBytes(9).toString('base64url');
}

function saveCredentials(creds) {
  mkdirSync(dirname(CRED_PATH), { recursive: true });
  writeFileSync(CRED_PATH, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CRED_PATH, 0o600);
}

/* ---------- содержимое ---------- */

const EXPENSE_TEMPLATES = [
  {
    cat: 'Еда',
    items: ['обед', 'продукты', 'кофе с собой', 'ужин в кафе', 'доставка еды'],
    min: 220,
    max: 1600,
    freq: 0.72,
  },
  { cat: 'Транспорт', items: ['метро', 'такси', 'заправка'], min: 60, max: 900, freq: 0.42 },
  {
    cat: 'Развлечения',
    items: ['кино', 'бар с друзьями', 'концерт'],
    min: 500,
    max: 3200,
    freq: 0.12,
  },
  { cat: 'Здоровье', items: ['аптека', 'приём у врача'], min: 400, max: 3800, freq: 0.06 },
  {
    cat: 'Покупки',
    items: ['одежда', 'маркетплейс', 'техника для дома'],
    min: 900,
    max: 6500,
    freq: 0.16,
  },
  { cat: 'Связь', items: ['мобильная связь', 'домашний интернет'], min: 400, max: 800, freq: 0.05 },
  {
    cat: 'Подписки',
    items: ['подписка на музыку', 'облачное хранилище'],
    min: 199,
    max: 699,
    freq: 0.05,
  },
  { cat: 'Жильё', items: ['коммунальные услуги'], min: 3000, max: 6000, freq: 0.03 },
];

const MOOD_TAGS = [
  'спорт',
  'работа',
  'семья',
  'прогулка',
  'сон',
  'продуктивно',
  'устал',
  'стресс',
  'хорошее настроение',
];
const NOTES = [
  'День прошёл спокойно, много успел.',
  'Немного устал, но в целом хороший день.',
  'Много встреч, мало времени на себя.',
  'Выспался и был продуктивен.',
  'Вечером прогулка — стало легче.',
  null,
  null,
];

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log('Демо-данные «Пульса»: старт.');

    // 1. Системные категории — общие, пользовательские данные не трогаем.
    for (const [id, name, icon, color, kind] of SYSTEM_CATEGORIES) {
      await prisma.category.upsert({
        where: { id },
        create: { id, name, icon, color, kind, isSystem: true },
        update: {},
      });
    }
    const categoryRows = await prisma.category.findMany({ where: { userId: null } });
    const catId = new Map(categoryRows.map((row) => [row.name, row.id]));

    // 2. Идемпотентность: убираем прошлых демо-пользователей (каскад снесёт всё).
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: DEMO.email },
          { email: FRIEND.email },
          { nickname: DEMO.nickname },
          { nickname: FRIEND.nickname },
        ],
      },
    });

    // 3. Учётные данные (переиспользуем, если файл уже есть).
    const stored = loadCredentials();
    const creds = stored ?? {
      demo: { email: DEMO.email, nickname: DEMO.nickname, password: randomPassword() },
      friend: { email: FRIEND.email, nickname: FRIEND.nickname, password: randomPassword() },
    };

    const hash = (password) =>
      argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
    const verifiedAt = new Date();

    const demo = await prisma.user.create({
      data: {
        email: DEMO.email,
        nickname: DEMO.nickname,
        passwordHash: await hash(creds.demo.password),
        emailVerifiedAt: verifiedAt,
        role: 'user',
        timezone: 'Europe/Moscow',
        currency: 'RUB',
        locale: 'ru',
        goals: ['money', 'health', 'habits'],
        notificationsEnabled: true,
        quietHoursStart: 23,
        quietHoursEnd: 7,
        profileVisibility: 'public',
        onboardingStep: 4,
        onboardingCompletedAt: verifiedAt,
        checkinTimesPerDay: 3,
        checkinTimes: ['09:00', '15:00', '21:00'],
      },
    });

    const friend = await prisma.user.create({
      data: {
        email: FRIEND.email,
        nickname: FRIEND.nickname,
        passwordHash: await hash(creds.friend.password),
        emailVerifiedAt: verifiedAt,
        role: 'user',
        timezone: 'Europe/Moscow',
        currency: 'RUB',
        locale: 'ru',
        goals: ['money'],
        profileVisibility: 'public',
        onboardingStep: 4,
        onboardingCompletedAt: verifiedAt,
      },
    });

    // 4. Счета.
    const card = await prisma.account.create({
      data: {
        userId: demo.id,
        name: 'Зарплатная карта',
        type: 'card',
        balance: 0,
        currency: 'RUB',
      },
    });
    const cash = await prisma.account.create({
      data: { userId: demo.id, name: 'Наличные', type: 'cash', balance: 30000, currency: 'RUB' },
    });
    const savings = await prisma.account.create({
      data: {
        userId: demo.id,
        name: 'Накопительный счёт',
        type: 'savings',
        balance: 120000,
        currency: 'RUB',
      },
    });

    // 5. Транзакции за ~90 дней с реальной динамикой.
    const transactions = [];
    const balanceDelta = new Map([
      [card.id, 0],
      [cash.id, 0],
      [savings.id, 0],
    ]);

    for (let offset = 89; offset >= 0; offset -= 1) {
      const day = addDays(TODAY, -offset);
      const dom = day.getUTCDate();

      // Зарплата раз в месяц (5-го) и редкий прочий доход.
      if (dom === 5) {
        transactions.push({
          userId: demo.id,
          accountId: card.id,
          categoryId: catId.get('Зарплата'),
          type: 'income',
          amount: 95000,
          currency: 'RUB',
          rate: 1,
          amountBase: 95000,
          date: day,
          comment: 'зарплата',
        });
        balanceDelta.set(card.id, balanceDelta.get(card.id) + 95000);
      }
      if (rnd() < 0.12) {
        const amount = between(1500, 9000);
        transactions.push({
          userId: demo.id,
          accountId: card.id,
          categoryId: catId.get('Прочий доход'),
          type: 'income',
          amount,
          currency: 'RUB',
          rate: 1,
          amountBase: amount,
          date: day,
          comment: pick(['кэшбэк', 'возврат за заказ', 'подарок']),
        });
        balanceDelta.set(card.id, balanceDelta.get(card.id) + amount);
      }

      for (const template of EXPENSE_TEMPLATES) {
        if (rnd() > template.freq) continue;
        const amount = round2(between(template.min, template.max));
        const fromCash = rnd() < 0.08;
        const account = fromCash ? cash : card;
        const comment = pick(template.items);
        transactions.push({
          userId: demo.id,
          accountId: account.id,
          categoryId: catId.get(template.cat),
          type: 'expense',
          amount,
          currency: 'RUB',
          rate: 1,
          amountBase: amount,
          date: day,
          comment,
        });
        balanceDelta.set(account.id, balanceDelta.get(account.id) - amount);
      }
    }

    // Два перевода на накопительный счёт.
    for (const offset of [60, 20]) {
      const day = addDays(TODAY, -offset);
      const amount = offset === 60 ? 20000 : 15000;
      transactions.push({
        userId: demo.id,
        accountId: card.id,
        transferAccountId: savings.id,
        type: 'transfer',
        amount,
        currency: 'RUB',
        rate: 1,
        amountBase: amount,
        toAmount: amount,
        date: day,
        comment: 'перевод на накопления',
      });
      balanceDelta.set(card.id, balanceDelta.get(card.id) - amount);
      balanceDelta.set(savings.id, balanceDelta.get(savings.id) + amount);
    }

    await prisma.transaction.createMany({
      data: transactions.map((item) => ({
        ...item,
        createdAt: atHour(item.date, 12),
        updatedAt: atHour(item.date, 12),
      })),
    });

    await prisma.account.update({
      where: { id: card.id },
      data: { balance: round2(balanceDelta.get(card.id) ?? 0) },
    });
    await prisma.account.update({
      where: { id: cash.id },
      data: { balance: round2(30000 + (balanceDelta.get(cash.id) ?? 0)) },
    });
    await prisma.account.update({
      where: { id: savings.id },
      data: { balance: round2(120000 + (balanceDelta.get(savings.id) ?? 0)) },
    });

    // 6. Бюджеты на текущий и два прошлых месяца.
    const budgetPlan = [
      ['Еда', 30000],
      ['Транспорт', 8000],
      ['Развлечения', 10000],
      ['Покупки', 20000],
      ['Жильё', 8000],
    ];
    const budgets = [];
    for (const monthOffset of [0, 1, 2]) {
      const monthDate = new Date(
        Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() - monthOffset, 1),
      );
      const month = monthKey(monthDate);
      for (const [name, limit] of budgetPlan) {
        budgets.push({
          userId: demo.id,
          categoryId: catId.get(name),
          month,
          limit,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }
    await prisma.budget.createMany({ data: budgets, skipDuplicates: true });

    // 7. Чек-ины: ~70 за 90 дней, последние 12 дней — подряд (даёт серию).
    const checkIns = [];
    for (let offset = 89; offset >= 0; offset -= 1) {
      const day = addDays(TODAY, -offset);
      const inStreak = offset <= 11;
      if (!inStreak && rnd() > 0.78) continue;
      const moodBase = 3 + (rnd() < 0.6 ? 1 : 0) - (rnd() < 0.25 ? 1 : 0);
      const mood = Math.max(1, Math.min(5, moodBase));
      const tagCount = 1 + Math.floor(rnd() * 2);
      const tags = [...new Set(Array.from({ length: tagCount }, () => pick(MOOD_TAGS)))];
      const occurredAt = atHour(day, 18); // ~21:00 по Москве
      checkIns.push({
        userId: demo.id,
        mood,
        energy: Math.max(1, Math.min(5, 3 + (rnd() < 0.5 ? 1 : 0) - (rnd() < 0.3 ? 1 : 0))),
        stress: Math.max(1, Math.min(5, 2 + (rnd() < 0.5 ? 1 : 0))),
        sleepHours: round2(between(4.5, 8.5)),
        water: Math.round(between(4, 10)),
        steps: Math.round(between(2500, 14000)),
        tags,
        note: pick(NOTES),
        daySummary: offset % 7 === 0 ? 'Неделя позади: держусь в графике.' : null,
        slot: 'evening',
        occurredAt,
        createdAt: occurredAt,
      });
    }
    await prisma.checkIn.createMany({ data: checkIns });

    // 8. Две цели, одна — примерно наполовину.
    const goalHoliday = await prisma.goal.create({
      data: {
        userId: demo.id,
        title: 'Отпуск на море',
        targetAmount: 200000,
        savedAmount: 100000,
        deadline: addDays(TODAY, 120),
        image: '🏖️',
        visibility: 'public',
        currency: 'RUB',
      },
    });
    const goalLaptop = await prisma.goal.create({
      data: {
        userId: demo.id,
        title: 'Новый ноутбук',
        targetAmount: 120000,
        savedAmount: 30000,
        deadline: addDays(TODAY, 200),
        image: '💻',
        visibility: 'subscribers',
        accountId: savings.id,
        currency: 'RUB',
      },
    });

    const holidayDeposits = [0, 30, 60].map((offset, index) => ({
      goalId: goalHoliday.id,
      userId: demo.id,
      accountId: savings.id,
      amount: index === 0 ? 40000 : 30000,
      date: addDays(TODAY, -(offset + 10)),
      createdAt: new Date(),
    }));
    const laptopDeposits = [40].map((offset) => ({
      goalId: goalLaptop.id,
      userId: demo.id,
      accountId: savings.id,
      amount: 30000,
      date: addDays(TODAY, -offset),
      createdAt: new Date(),
    }));
    await prisma.goalDeposit.createMany({ data: [...holidayDeposits, ...laptopDeposits] });

    // 9. Привычки с отметками и серией.
    const habitWater = await prisma.habit.create({
      data: { userId: demo.id, name: 'Вода 8 стаканов', icon: '💧', goalType: 'daily' },
    });
    const habitStretch = await prisma.habit.create({
      data: { userId: demo.id, name: 'Зарядка утром', icon: '🏃', goalType: 'daily' },
    });
    const habitReading = await prisma.habit.create({
      data: {
        userId: demo.id,
        name: 'Чтение 20 минут',
        icon: '📚',
        goalType: 'weekly',
        perWeek: 5,
      },
    });

    const habitLogs = [];
    for (let offset = 29; offset >= 0; offset -= 1) {
      const day = addDays(TODAY, -offset);
      if (offset <= 11 || rnd() < 0.75)
        habitLogs.push({
          habitId: habitWater.id,
          userId: demo.id,
          date: day,
          done: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      if (rnd() < 0.7)
        habitLogs.push({
          habitId: habitStretch.id,
          userId: demo.id,
          date: day,
          done: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      if (rnd() < 0.55)
        habitLogs.push({
          habitId: habitReading.id,
          userId: demo.id,
          date: day,
          done: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
    }
    await prisma.habitLog.createMany({ data: habitLogs, skipDuplicates: true });

    // 10. Регулярный платёж (аренда).
    const nextMonth = new Date(
      Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() + 1, 5, 7, 0, 0),
    );
    await prisma.recurringPayment.create({
      data: {
        userId: demo.id,
        name: 'Аренда квартиры',
        amount: 35000,
        type: 'expense',
        accountId: card.id,
        categoryId: catId.get('Жильё'),
        frequency: 'monthly',
        scheduleDay: 5,
        timeOfDay: '10:00',
        timezone: 'Europe/Moscow',
        nextRunAt: nextMonth,
        active: true,
      },
    });

    // 11. Подписки (демо ↔ friend).
    await prisma.follow.createMany({
      data: [
        { followerId: demo.id, followingId: friend.id },
        { followerId: friend.id, followingId: demo.id },
      ],
      skipDuplicates: true,
    });

    // 12. Семья с общим счётом и общей целью.
    const family = await prisma.family.create({ data: { name: 'Семья Демо', ownerId: demo.id } });
    await prisma.familyMember.createMany({
      data: [
        { familyId: family.id, userId: demo.id, role: 'owner' },
        { familyId: family.id, userId: friend.id, role: 'member' },
      ],
      skipDuplicates: true,
    });
    const familyAccount = await prisma.familyAccount.create({
      data: {
        familyId: family.id,
        name: 'Общий счёт семьи',
        type: 'card',
        balance: 50000,
        currency: 'RUB',
      },
    });
    await prisma.familyTransaction.createMany({
      data: [
        {
          accountId: familyAccount.id,
          userId: demo.id,
          kind: 'income',
          amount: 40000,
          note: 'взнос в общий бюджет',
          date: addDays(TODAY, -25),
          createdAt: new Date(),
        },
        {
          accountId: familyAccount.id,
          userId: friend.id,
          kind: 'income',
          amount: 25000,
          note: 'взнос в общий бюджет',
          date: addDays(TODAY, -25),
          createdAt: new Date(),
        },
        {
          accountId: familyAccount.id,
          userId: demo.id,
          kind: 'expense',
          amount: 12000,
          note: 'продукты на неделю',
          date: addDays(TODAY, -10),
          createdAt: new Date(),
        },
        {
          accountId: familyAccount.id,
          userId: friend.id,
          kind: 'expense',
          amount: 8000,
          note: 'бытовая химия',
          date: addDays(TODAY, -4),
          createdAt: new Date(),
        },
      ],
    });
    const familyGoal = await prisma.familyGoal.create({
      data: {
        familyId: family.id,
        title: 'Ремонт кухни',
        targetAmount: 150000,
        savedAmount: 60000,
        deadline: addDays(TODAY, 180),
        image: '🛠️',
        currency: 'RUB',
      },
    });
    await prisma.familyGoalDeposit.createMany({
      data: [
        {
          goalId: familyGoal.id,
          userId: demo.id,
          amount: 40000,
          date: addDays(TODAY, -40),
          createdAt: new Date(),
        },
        {
          goalId: familyGoal.id,
          userId: friend.id,
          amount: 20000,
          date: addDays(TODAY, -12),
          createdAt: new Date(),
        },
      ],
    });

    // 13. Пост в ленте (веха цели) — виден подписчикам.
    await prisma.post.create({
      data: {
        userId: demo.id,
        type: 'achievement',
        payload: { code: 'goal_half' },
        visibility: 'public',
        createdAt: addDays(TODAY, -14),
      },
    });

    // 14. Челлендж на серию чек-инов, участники demo и friend.
    const challenge = await prisma.challenge.create({
      data: {
        ownerId: demo.id,
        title: '30 дней осознанных трат',
        kind: 'streak_checkin',
        durationDays: 30,
        startDate: addDays(TODAY, -5),
        visibility: 'friends',
        inviteCode: randomBytes(6).toString('hex'),
      },
    });
    await prisma.challengeParticipant.createMany({
      data: [
        { challengeId: challenge.id, userId: demo.id },
        { challengeId: challenge.id, userId: friend.id },
      ],
      skipDuplicates: true,
    });
    await prisma.challengeCheck.createMany({
      data: [0, 1, 2, 3, 4].map((offset) => ({
        challengeId: challenge.id,
        userId: demo.id,
        date: addDays(TODAY, -offset),
        ok: true,
        createdAt: new Date(),
      })),
      skipDuplicates: true,
    });

    // 15. Капсула времени (откроется через год, тело зашифровано).
    await prisma.timeCapsule.create({
      data: {
        userId: demo.id,
        title: 'Письмо себе через год',
        bodyEncrypted: secretBoxEncrypt(
          'Привет из прошлого! Если ты читаешь это — год прошёл не зря.',
        ),
        openAt: addDays(TODAY, 365),
      },
    });

    // 16. Достижения (детерминированные; остальные подтянет ленивый сервис).
    await prisma.userAchievement.createMany({
      data: [
        'first_checkin',
        'checkin_streak_7',
        'first_transaction',
        'first_budget_closed',
        'first_goal',
        'goal_half',
      ].map((code) => ({ userId: demo.id, code, earnedAt: addDays(TODAY, -7) })),
      skipDuplicates: true,
    });

    // 17. Публичный профиль с карточками.
    await prisma.profile.create({
      data: {
        userId: demo.id,
        bio: 'Веду бюджет и слежу за самочувствием в «Пульсе». Люблю спорт и книги.',
      },
    });
    await prisma.profile.create({
      data: { userId: friend.id, bio: 'Учусь копить и держать баланс.' },
    });

    const cardSnippet =
      '<p style="margin:0"><strong>Демо-карточка</strong> — я веду бюджет в «Пульсе».</p>';
    await prisma.profileCard.createMany({
      data: [
        { userId: demo.id, type: 'savings', visibility: 'public', mode: 'amount', position: 0 },
        {
          userId: demo.id,
          type: 'checkin_streak',
          visibility: 'public',
          mode: 'percent',
          position: 1,
        },
        { userId: demo.id, type: 'avg_mood', visibility: 'public', mode: 'percent', position: 2 },
        {
          userId: demo.id,
          type: 'achievements',
          visibility: 'public',
          mode: 'percent',
          position: 3,
        },
        { userId: demo.id, type: 'goals', visibility: 'public', mode: 'percent', position: 4 },
        {
          userId: demo.id,
          type: 'html_page',
          visibility: 'public',
          mode: 'percent',
          title: 'Визитка',
          html: cardSnippet,
          position: 5,
        },
      ],
      skipDuplicates: true,
    });

    // 18. HTML-страница из шаблона «Визитка» (публикация + версия).
    const htmlPage = await prisma.htmlPage.create({ data: { userId: demo.id, published: false } });
    const version = await prisma.htmlPageVersion.create({
      data: {
        pageId: htmlPage.id,
        userId: demo.id,
        html: BUSINESS_CARD_HTML,
        note: 'Шаблон «Визитка»',
        checkStatus: 'ok',
        checkReasons: [],
      },
    });
    await prisma.htmlPage.update({
      where: { id: htmlPage.id },
      data: { currentVersionId: version.id, published: true },
    });

    // 19. Сохраняем учётные данные.
    saveCredentials(creds);

    // 20. Пробуем прогреть ленивые сервисы через живой API (не критично).
    const apiTouched = await tryTriggerApi(creds.demo);

    const counts = {
      счета: 3,
      транзакции: transactions.length,
      бюджеты: budgets.length,
      чекИны: checkIns.length,
      цели: 2,
      привычки: 3,
      отметкиПривычек: habitLogs.length,
    };

    console.log('Готово. Наполнено:', counts);
    console.log(`Демо-пользователь: ${DEMO.email} (ник ${DEMO.nickname})`);
    console.log(`Друг: ${FRIEND.email} (ник ${FRIEND.nickname})`);
    console.log(`Учётные данные: ${CRED_PATH} (права 600)`);
    console.log(`Пароль demo (единожды): ${creds.demo.password}`);
    console.log(`Пароль friend (единожды): ${creds.friend.password}`);
    console.log(
      apiTouched
        ? 'Ленивые сервисы прогреты через API.'
        : 'API недоступен — прогреются при первом открытии страниц.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

/* ---------- шаблон «Визитка» (копия packages/shared/src/html-templates.ts) ---------- */

const BUSINESS_CARD_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Визитка</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
  .card { width: 100%; max-width: 420px; background: #1e293b; border-radius: 20px; padding: 32px; box-shadow: 0 20px 45px rgba(0,0,0,.35); }
  .avatar { width: 72px; height: 72px; border-radius: 50%; background: #6366f1; display: flex; align-items: center; justify-content: center; font-size: 30px; margin-bottom: 20px; }
  h1 { margin: 0 0 4px; font-size: 26px; }
  .role { margin: 0 0 20px; color: #94a3b8; }
  p.bio { margin: 0 0 24px; line-height: 1.6; color: #cbd5e1; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  li a { color: #a5b4fc; text-decoration: none; }
  li a:hover { text-decoration: underline; }
  .label { display: inline-block; width: 84px; color: #64748b; }
</style>
</head>
<body>
  <main class="card">
    <div class="avatar" aria-hidden="true">🙂</div>
    <h1>Демо Пользователь</h1>
    <p class="role">Продуктовый дизайнер</p>
    <p class="bio">Коротко о себе: веду бюджет и дневник самочувствия в «Пульсе».</p>
    <ul>
      <li><span class="label">Почта</span><a href="mailto:demo@puls.local">demo@puls.local</a></li>
      <li><span class="label">Сайт</span><a href="https://example.com" rel="noopener noreferrer" target="_blank">example.com</a></li>
    </ul>
  </main>
</body>
</html>`;

/* ---------- необязательный прогрев через HTTP API ---------- */

async function tryTriggerApi(demoCreds) {
  const base =
    process.env.SEED_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const cookies = new Map();
  const applyCookies = (response) => {
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  };
  const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');

  try {
    const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
    if (!health.ok) return false;

    const csrfResponse = await fetch(`${base}/api/auth/csrf`);
    applyCookies(csrfResponse);
    const csrf = cookies.get('puls_csrf') ?? '';
    const loginResponse = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, cookie: cookieHeader() },
      body: JSON.stringify({ email: demoCreds.email, password: demoCreds.password }),
    });
    applyCookies(loginResponse);
    if (!loginResponse.ok) return false;

    // GET не требует CSRF: лениво выдаём достижения и считаем дневные агрегаты.
    await fetch(`${base}/api/achievements`, { headers: { cookie: cookieHeader() } });
    await fetch(`${base}/api/profile`, { headers: { cookie: cookieHeader() } });
    await fetch(`${base}/api/stats/report?period=month`, { headers: { cookie: cookieHeader() } });
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error('Демо-данные: ошибка —', error);
  process.exit(1);
});
