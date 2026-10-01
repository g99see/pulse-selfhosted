// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Управление пользователями «Пульса» из консоли сервера.
 * Запускается через scripts/users.sh внутри контейнера api: код приходит на
 * stdin (`node - <команда> ...`), поэтому в образ ничего добавлять не нужно.
 *
 * Пароли хешируются так же, как в API (Argon2id). Созданный здесь пользователь
 * сразу с подтверждённой почтой и проходит онбординг при первом входе.
 */
/* global require, process, console */
'use strict';

const { randomBytes } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');

const NICKNAME_REGEX = /^[a-z0-9][a-z0-9_-]{2,31}$/;
// Совпадает с RESERVED_NICKNAMES в packages/shared/src/auth.ts.
const RESERVED = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'favicon',
  'health',
  'help',
  'login',
  'logout',
  'me',
  'onboarding',
  'register',
  'robots',
  'sessions',
  'settings',
  'signin',
  'signup',
  'static',
  'support',
  'user',
  'users',
  'verify-email',
  'www',
]);
const MODES = ['open', 'invite', 'closed'];
const ARGON2 = {
  type: argon2.argon2id,
  memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19_456),
  timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
  parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
};

const HELP = `Пользователи «Пульса»

  scripts/users.sh list                                  все пользователи
  scripts/users.sh add <email> <ник> [опции]             новый пользователь
      --admin              сделать администратором
      --password <пароль>  свой пароль (иначе придумаю и покажу один раз)
      --locale en          язык интерфейса (ru по умолчанию)
  scripts/users.sh password <email> [--password <пароль>] новый пароль (выйдет со всех устройств)
  scripts/users.sh role <email> admin|user               выдать или снять права администратора
  scripts/users.sh verify <email>                        подтвердить почту вручную
  scripts/users.sh registration [open|invite|closed]     показать или сменить режим регистрации
`;

class UserError extends Error {}

function fail(message) {
  throw new UserError(message);
}

/** Пароль без похожих символов (0/O, 1/l): его будут переписывать руками. */
function generatePassword() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--admin') flags.admin = true;
    else if (arg === '--password' || arg === '--locale') {
      if (argv[i + 1] === undefined) fail(`После ${arg} нужно значение`);
      flags[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--')) fail(`Неизвестная опция ${arg}`);
    else positional.push(arg);
  }
  return { positional, flags };
}

function normEmail(value) {
  const email = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`Некорректный email: «${value ?? ''}»`);
  return email;
}

function checkPassword(password) {
  if (password.length < 8) fail('Пароль короче 8 символов');
  if (password.length > 128) fail('Пароль длиннее 128 символов');
  return password;
}

async function findUser(prisma, emailArg) {
  const email = normEmail(emailArg);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) fail(`Пользователь ${email} не найден. Список: scripts/users.sh list`);
  return user;
}

function printPassword(password, generated) {
  if (!generated) return;
  console.log('');
  console.log(`  Пароль: ${password}`);
  console.log('  Покажу только сейчас: перепишите или передайте человеку.');
  console.log('  Забыли — задайте новый: scripts/users.sh password <email>');
}

const commands = {
  async list(prisma) {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { email: true, nickname: true, role: true, emailVerifiedAt: true, createdAt: true },
    });
    if (users.length === 0) {
      console.log('Пользователей пока нет.');
      return;
    }
    console.log(`Пользователей: ${users.length}\n`);
    for (const u of users) {
      const role = u.role === 'admin' ? 'админ' : 'пользователь';
      const verified = u.emailVerifiedAt ? 'почта подтверждена' : 'почта НЕ подтверждена';
      console.log(
        `  ${u.email}  @${u.nickname}  ${role}, ${verified}, с ${u.createdAt.toISOString().slice(0, 10)}`,
      );
    }
  },

  async add(prisma, { positional, flags }) {
    const [emailArg, nickArg] = positional;
    if (!emailArg || !nickArg) fail('Нужно: scripts/users.sh add <email> <ник>');
    const email = normEmail(emailArg);
    const nickname = String(nickArg).trim().toLowerCase();
    if (!NICKNAME_REGEX.test(nickname)) {
      fail('Ник: 3–32 символа, латиница, цифры, «-» и «_», начинается с буквы или цифры');
    }
    if (RESERVED.has(nickname)) fail(`Ник «${nickname}» зарезервирован, выберите другой`);
    const locale = flags.locale ?? 'ru';
    if (!['ru', 'en'].includes(locale)) fail('--locale: ru или en');

    const taken = await prisma.user.findFirst({ where: { OR: [{ email }, { nickname }] } });
    if (taken)
      fail(taken.email === email ? `Почта ${email} уже занята` : `Ник @${nickname} уже занят`);

    const generated = flags.password === undefined;
    const password = checkPassword(generated ? generatePassword() : flags.password);
    await prisma.user.create({
      data: {
        email,
        nickname,
        passwordHash: await argon2.hash(password, ARGON2),
        emailVerifiedAt: new Date(),
        role: flags.admin ? 'admin' : 'user',
        locale,
      },
    });
    console.log(`Готово: ${email} (@${nickname})${flags.admin ? ', администратор' : ''}.`);
    console.log(
      'При первом входе человек пройдёт короткую настройку: валюта, часовой пояс, первый счёт.',
    );
    printPassword(password, generated);
  },

  async password(prisma, { positional, flags }) {
    const user = await findUser(prisma, positional[0]);
    const generated = flags.password === undefined;
    const password = checkPassword(generated ? generatePassword() : flags.password);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await argon2.hash(password, ARGON2) },
      }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);
    console.log(`Пароль для ${user.email} сменён, все его входы на других устройствах завершены.`);
    printPassword(password, generated);
  },

  async role(prisma, { positional }) {
    const user = await findUser(prisma, positional[0]);
    const role = positional[1];
    if (!['admin', 'user'].includes(role)) fail('Роль: admin или user');
    if (role === 'user' && user.role === 'admin') {
      const admins = await prisma.user.count({ where: { role: 'admin' } });
      if (admins <= 1) fail('Это последний администратор — сначала назначьте другого');
    }
    await prisma.user.update({ where: { id: user.id }, data: { role } });
    console.log(
      `${user.email}: теперь ${role === 'admin' ? 'администратор' : 'обычный пользователь'}.`,
    );
  },

  async verify(prisma, { positional }) {
    const user = await findUser(prisma, positional[0]);
    if (user.emailVerifiedAt) {
      console.log(`${user.email}: почта уже подтверждена.`);
      return;
    }
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    console.log(`${user.email}: почта подтверждена, теперь можно войти.`);
  },

  async registration(prisma, { positional }) {
    const mode = positional[0];
    const describe = {
      open: 'open — кто угодно может зарегистрироваться сам (нужна настроенная почта)',
      invite: 'invite — сами регистрироваться нельзя, пользователей добавляет администратор',
      closed: 'closed — регистрация закрыта полностью',
    };
    if (!mode) {
      const s = await prisma.instanceSettings.findUnique({ where: { id: 'instance' } });
      console.log(`Сейчас: ${describe[s?.registrationMode ?? 'open']}`);
      return;
    }
    if (!MODES.includes(mode)) fail('Режим: open, invite или closed');
    await prisma.instanceSettings.upsert({
      where: { id: 'instance' },
      update: { registrationMode: mode },
      create: { id: 'instance', registrationMode: mode },
    });
    console.log(`Готово. ${describe[mode]}`);
    if (mode === 'open' && !process.env.SMTP_URL) {
      console.log(
        'Внимание: SMTP_URL не задан — новые люди не получат письмо и не смогут подтвердить почту.',
      );
    }
  },
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '-h' || command === '--help') {
    console.log(HELP);
    return;
  }
  const handler = commands[command];
  if (!handler) fail(`Неизвестная команда «${command}».\n\n${HELP}`);
  const prisma = new PrismaClient();
  try {
    await handler(prisma, parseArgs(rest));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof UserError ? `Ошибка: ${error.message}` : error);
  process.exit(1);
});
