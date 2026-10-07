# Разработчикам

Обзор для тех, кто хочет собрать, запустить и менять «Пульс» локально. Архитектура
— на странице [Архитектура](/dev/architecture), правила вклада — в разделе
[Как внести вклад](/dev/contributing).

## Стек

| Слой | Технологии |
| --- | --- |
| Монорепо | pnpm workspaces, TypeScript |
| Фронтенд | Next.js 15 (App Router, standalone), React, Tailwind |
| Бэкенд | NestJS, Prisma, PostgreSQL 16 |
| Кеш и очереди | Valkey 8 + BullMQ |
| Общие схемы | `@puls/shared` (Zod) |
| Поставка | Docker Compose, Caddy (авто-HTTPS) |
| Тесты | Vitest (unit + smoke), Playwright (e2e) |
| CI | GitHub Actions |

Репозиторий — монорепо `pnpm` с workspaces `apps/*` и `packages/*`.

## Требования

- **Node.js ≥ 20**
- **pnpm 11** (`corepack enable`)
- **Docker с Compose** (для PostgreSQL 16 и Valkey 8)

## Быстрый старт

```bash
pnpm install
cp .env.example .env          # заполните пароли
pnpm docker:dev:up            # postgres:16 + valkey:8 с портами на хост
pnpm db:migrate               # prisma migrate dev
pnpm build && pnpm test       # сборка всех пакетов и unit-тесты
pnpm dev                      # api и web в watch-режиме
```

Полезные адреса в dev: API `http://localhost:3001/health`, web
`http://localhost:3000`.

## Команды проверок

```bash
pnpm lint            # ESLint (flat config) по всем пакетам
pnpm typecheck       # tsc --noEmit по всем пакетам
pnpm test            # Vitest: unit-тесты (без БД)
pnpm test:smoke      # Vitest: smoke-тест API против живого PostgreSQL
pnpm e2e             # Playwright
pnpm format:check    # Prettier
pnpm license:check   # совместимость лицензий зависимостей
```

Те же проверки выполняет CI (`.github/workflows/ci.yml`), джобы: **lint**
(линт + формат), **typecheck**, **test** (unit + smoke против сервисов
postgres и valkey), **build**, **license-check**, **e2e** (Playwright в Chromium).

## Структура репозитория

```
puls/
├── apps/
│   ├── api/                      NestJS + Prisma
│   │   ├── prisma/schema.prisma  модели БД
│   │   ├── prisma/migrations/    миграции (по одной на фичу)
│   │   ├── src/                  модули NestJS
│   │   └── test/                 *.integration.test.ts против PostgreSQL
│   └── web/                      Next.js 15 (App Router)
│       ├── src/app/              маршруты
│       ├── src/components/       React-компоненты (клиентские)
│       ├── src/lib/              клиенты API, i18n, форматирование
│       ├── e2e/                  Playwright-сценарии
│       └── test/                 unit-тесты (Vitest)
├── packages/shared/              Zod-схемы, типы, чистые функции
├── docs/                         PLAN.md и PHASE*.md
├── scripts/                      backup.sh, restore.sh, upgrade.sh, check-licenses.mjs
├── docker-compose.yml            postgres, valkey, api, web, backup, caddy
├── docker-compose.dev.yml        dev: порты 5432/6379 на хост
├── Caddyfile                     маршрутизация
├── .env.example                  все переменные окружения
└── .github/workflows/ci.yml
```

`apps/api/src` — по Nest-модулю на область (`*.module.ts`, `*.controller.ts`,
`*.service.ts`): `auth`, `account`, `finance`, `checkins`, `stats`, `insights`,
`achievements`, `goals`, `notifications`, `telegram`, `crypto`, `common`, `prisma`, `health`,
`setup`.

`apps/web/src` — защищённые экраны в `app/(app)/…`, публичные маршруты в
`app/login|register|verify-email|onboarding|setup`, приватная ссылка «Итог дня» в
`app/d/[token]`. Все тексты интерфейса — в `lib/i18n.ts` (ru/en).

## См. также

- [Архитектура](/dev/architecture)
- [Как внести вклад](/dev/contributing)
- [Настройка (.env)](/guide/configuration)
- [Установка за 15 минут](/guide/installation)
