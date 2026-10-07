# Фаза 5, блок I — Капсула времени (ТЗ §4, P2)

Письмо себе, которое открывается через месяц или год — вместе со статистикой
периода между созданием и открытием. Backend (NestJS + Prisma) и web (Next 15).

## Что внутри

- **Модель `TimeCapsule`** (`apps/api/prisma/schema.prisma`): `id`, `user_id`,
  `title`, `body_encrypted` (AES-256-GCM, см. `crypto/secret-box.ts`),
  `snapshot` (JSON со статистикой периода), `open_at`, `opened_at`,
  `created_at`. Миграция `20261001175000_time_capsules` (идемпотентная,
  `IF NOT EXISTS` — общее дерево).
- **Чистые функции** `packages/shared/src/capsules.ts`: пресеты дат
  («через месяц»/«через год» с зажимом дня), границы срока (+1 сутки … +10 лет),
  проверка доступности, сборка снимка статистики периода. Unit-тесты —
  `packages/shared/test/capsules.test.ts` (14 тестов).
- **API** `/api/capsules` под `SessionGuard` (`apps/api/src/capsules/`):
  - `POST /api/capsules` — создать (тело шифруется; срок — пресет или `openAt`);
  - `GET /api/capsules` — список (только метаданные);
  - `GET /api/capsules/:id` — до `open_at` только метаданные, после — расшифрованное
    письмо и снимок статистики;
  - `DELETE /api/capsules/:id` — удалить своё;
  - `POST /api/capsules/:id/dev-open` — dev/e2e-хук (в production отдаёт 404).
- **Планировщик** `CapsulesScheduler` (по образцу `notifications/scheduler.ts`):
  BullMQ/Valkey с таймерным фолбэком, CAS-захват по `opened_at`, в момент
  `open_at` собирает снимок и шлёт уведомление «капсула открылась» через
  `NotificationDispatcher::notifyCapsuleOpened`. Автостарт выключен в тестах
  (`NODE_ENV=test`), переменные `CAPSULES_SCHEDULER`, `CAPSULES_TICK_MS`.
- **Web**: экран `/capsules` (`apps/web/src/app/(app)/capsules/page.tsx`),
  клиент `lib/capsules-client.ts`, пункт навигации `app.nav.capsules`,
  строки в `i18n.ts` (ru + en).

## Статистика периода

Снимок собирается в момент **открытия** за интервал `[created_at, open_at]`:
траты и доходы (по `daily`-границам в часовом поясе пользователя, только
`expense`/`income`), среднее настроение и число чек-инов, состояние целей на
момент открытия (title, target, saved, percent). Снимок сохраняется в `snapshot`
и переиспользуется при повторном чтении. Цели — это срез «на сейчас», периода
у накопительных целей нет, поэтому в снимке они как состояние на момент
открытия.

## Приватность и выгрузка (ТЗ §6)

- Тело письма хранится зашифрованным (`body_encrypted`) и **не отдаётся**, пока
  `now < open_at`. API возвращает только `title`, `open_at`, `opened_at`, `created_at`.
- В реестре выгрузки (`account/data-registry.ts`) `time_capsules` добавлена с
  `secretColumns: ['body_encrypted']`: колонка распознаётся как секрет
  (`isSecretColumn`, суффикс `_encrypted`), поэтому в выгрузку тела **не попадает**.
  Сознательное решение: выгрузка идёт по колонкам, и расшифровка на лету
  потребовала бы спец-обработки таблицы. Пользователь-владелец читает письмо
  расшифрованным через `GET /api/capsules/:id` после открытия. Если понадобится
  включать тела капсул в выгрузку, это отдельное решение (владелец = тот, кто
  запрашивает свою выгрузку) — вне рамок блока.
- Пока не задан `APP_ENCRYPTION_KEY` и окружение production — капсулы недоступны
  (`503 capsules_unavailable`).

## Проверка (реальный вывод)

- `packages/shared` unit: 14/14 (`vitest run test/capsules.test.ts`).
- `apps/api` типчек: `tsc --noEmit` — 0 ошибок.
- `apps/api` интеграция: `vitest run test/capsules.integration.test.ts` — 5/5
  (шифрование тела, метаданные до открытия, снимок статистики, планировщик с CAS
  и уведомлением, изоляция владельца).
- `apps/web` типчек и `no-hardcoded-text` — зелёные.
- `apps/web` e2e `e2e/capsules.spec.ts` — см. отчёт прогона.

## Что не сделано

- Письмо в архиве выгрузки отдаётся без тела (см. выше) — намеренно.
- Отдельного экрана «открыть капсулу» нет: открытые капсулы раскрываются в общем
  списке. Пуш-уведомление ведёт на `/capsules`.
