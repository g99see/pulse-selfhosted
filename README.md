# Пульс

> Веб-сервис, который в одном месте ведёт личные финансы, самочувствие и достижения,
> а затем превращает эти данные в статистику и советы.

Полностью **self-hosted** и **open-source** (AGPL-3.0-or-later): вы разворачиваете сервис
на своём сервере одной командой Docker Compose и полностью контролируете данные.

Текущий статус: **Фаза 4 — AI-помощник, семейный режим, открытый API и документация**.
Фазы 1–3 реализованы: финансы, самочувствие, статистика, уведомления, PWA, цели,
импорт CSV, 2FA, вход через Google и Telegram, Telegram-бот, публичный профиль и
соцсеть, HTML-страница с песочницей, модерация и шаринг. План — [`docs/PLAN.md`](docs/PLAN.md),
статус блоков Фазы 4 — [`docs-site/phase4.md`](docs-site/phase4.md).

Полная документация (установка, настройка, использование, AI, API, администрирование)
публикуется из пакета [`docs-site/`](docs-site/) на VitePress.

## Стек

| Слой            | Технологии                                              |
| --------------- | ------------------------------------------------------- |
| Монорепо        | pnpm workspaces, TypeScript 5.9                         |
| Фронтенд        | Next.js 15 (App Router, standalone), React 19, Tailwind |
| Бэкенд          | NestJS 12, Prisma 6, PostgreSQL 16                      |
| Кеш и очереди   | Valkey 8 (+ BullMQ в Фазе 1)                            |
| Общие схемы     | `@puls/shared` (Zod)                                    |
| Тесты           | Vitest (unit + smoke), Playwright (e2e)                 |
| Поставка        | Docker Compose, Caddy (авто-HTTPS), GitHub Actions      |

## Структура репозитория

```
apps/
  api/        NestJS + Prisma, эндпоинт /health, миграции
  web/        Next.js 15, Tailwind, Playwright
packages/
  shared/     Zod-схемы, шкала настроения, форматирование денег
docker-compose.yml       postgres, valkey, api, web, caddy, backup + healthchecks
docker-compose.dev.yml   dev-оверрайд: порты 5432 и 6379 на хост
Caddyfile                маршрутизация + песочница пользовательского HTML
docs-site/               документация на VitePress (пакет @puls/docs)
scripts/                 backup.sh, restore.sh, upgrade.sh — эксплуатация (ТЗ §10)
```

## Быстрый старт (разработка)

Требования: Node.js ≥ 20, pnpm 11, Docker с Compose.

```bash
pnpm install
cp .env.example .env          # заполните пароли
pnpm docker:dev:up            # postgres:16 + valkey:8 с портами на хост
pnpm db:migrate               # prisma migrate dev
pnpm build && pnpm test       # сборка всех пакетов и unit-тесты
pnpm dev                      # запускает api и web в watch-режиме
```

Полезные адреса в dev: API `http://localhost:3001/health`, web `http://localhost:3000`.

## Проверки

```bash
pnpm lint            # ESLint (flat config) по всем пакетам
pnpm typecheck       # tsc --noEmit по всем пакетам
pnpm test            # Vitest: unit-тесты (без БД)
pnpm test:smoke      # Vitest: smoke-тест API против живого PostgreSQL
pnpm e2e             # Playwright: один smoke-сценарий лендинга
pnpm format:check    # Prettier
pnpm license:check   # совместимость лицензий зависимостей
pnpm --filter @puls/docs build   # сборка документации (VitePress)
pnpm --filter @puls/docs dev     # локальный просмотр документации
```

## Установка за 15 минут

Требования: Docker с Compose (и git). Node/pnpm для установки не нужны —
всё собирается в контейнерах.

Пошаговое руководство (домены и `SANDBOX_DOMAIN`, DNS, HTTPS, мастер первого
запуска) — [`docs-site/guide/installation.md`](docs-site/guide/installation.md);
описание всех переменных — [`docs-site/guide/configuration.md`](docs-site/guide/configuration.md).

```bash
# 1. Код
git clone <ваш-форк> puls && cd puls

# 2. Настройки: задайте POSTGRES_PASSWORD, DOMAIN и ACME_EMAIL
cp .env.example .env

# 3. Запуск: postgres, valkey, api, web, caddy, backup (порядок и healthchecks — сами)
docker compose up -d

# 4. Мастер первого запуска: откройте сайт и создайте администратора
#    http://localhost  (или https://$DOMAIN)  →  редирект на /setup
```

Caddy сам получит сертификаты Let's Encrypt для `$DOMAIN`; миграции Prisma
применяет контейнер `api` при старте. Первый пользователь создаётся мастером
`/setup` и получает роль `admin`; после этого мастер закрыт навсегда.

Проверить, что бэкап-сервис работает: `docker compose ps backup` (healthy) и
`ls backups/` — первый архив появится сразу после старта.

## Обновление

```bash
scripts/upgrade.sh     # бэкап → pull/build образов → up -d
```

Перед обновлением скрипт снимает резервную копию, затем перезапускает сервисы;
миграции Prisma применяются контейнером `api` при старте.

## Бэкап и восстановление (ТЗ §6, §10)

Сервис `backup` (образ `postgres:16-alpine`) раз в `BACKUP_INTERVAL_HOURS` (24)
снимает дамп PostgreSQL в custom-формате вместе с метаданными (версия миграции,
версия PostgreSQL) в `./backups/backup-<UTC>.tar.gz` и хранит `BACKUP_KEEP` (7)
последних архивов. Healthcheck сервиса следит за свежестью последнего бэкапа.

```bash
# Резервная копия вручную (на хосте — дамп через `docker compose exec postgres`)
scripts/backup.sh

# Восстановление одной командой (сверяет версию схемы с архивом)
scripts/restore.sh backups/backup-20261001T120000Z.tar.gz

# Если БД ушла вперёд — восстановление остановится; повторите с --force
scripts/restore.sh backups/backup-....tar.gz --force

# После восстановления накатить миграции текущего образа
scripts/restore.sh backups/backup-....tar.gz --migrate
```

Переменные: `BACKUP_DIR`, `BACKUP_KEEP`, `BACKUP_INTERVAL_HOURS`, `PGDATABASE`,
`PGHOST/PGPORT/PGUSER/PGPASSWORD`. Подробности — [`docs/PHASE1-OPS.md`](docs/PHASE1-OPS.md).

## Развёртывание за деталями

Caddy сам получит сертификаты Let's Encrypt для `$DOMAIN` и поддомена песочницы
`$SANDBOX_DOMAIN`. Миграции применяются контейнером `api` при старте.

## Лицензия

Код распространяется по **AGPL-3.0-or-later**. Если вы запускаете изменённую версию как
публичный сервис, вы обязаны открыть свои изменения. Пользовательский контент
(HTML-страницы, тексты) лицензией кода не покрывается и принадлежит авторам.

Участие в проекте — [`CONTRIBUTING.md`](CONTRIBUTING.md); сообщения об уязвимостях —
[`SECURITY.md`](SECURITY.md).
