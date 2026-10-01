// SPDX-License-Identifier: AGPL-3.0-or-later
# Фаза 2 — регулярные платежи (ТЗ §3.2)

Регулярные платежи: аренда, подписки и другие периодические списания. Транзакция
создаётся автоматически в срок, за день до списания приходит напоминание.

## Что сделано

- **Модель `RecurringPayment`** (`recurring_payments`): название, сумма
  (`Decimal(14,2)`), тип (`expense`/`income`), категория, счёт, периодичность
  (`weekly`/`monthly`/`yearly`) + день (`schedule_day`, для `weekly` — 1–7 Пн–Вс,
  для `monthly`/`yearly` — 1–31; `schedule_month` — только для `yearly`), время
  списания (`time_of_day`, по умолчанию `10:00`), часовой пояс пользователя
  (`timezone`), следующая дата (`next_run_at`), активность (`active`),
  `last_run_at` и `reminded_for` (идемпотентность напоминания).
- **Чистая логика в `@puls/shared`** (`packages/shared/src/recurring.ts`):
  - `nextOccurrenceDate` / `isOccurrenceDate` — следующая плановая дата с
    прижатием к концу месяца (31-е → 30/28/29, високосный февраль).
  - `nextOccurrence` / `advanceOccurrence` / `upcomingOccurrences` — ближайшие
    списания в часовом поясе пользователя (перевод «настенного» времени в UTC с
    корректной обработкой переходов DST).
  - Zod-схемы `RecurringPaymentCreateSchema` / `RecurringPaymentUpdateSchema` /
    `RecurringPaymentActiveSchema` и контракты ответов.
- **API** (`apps/api/src/finance`), всё под `SessionGuard` и изолировано по
  `userId`:
  - `GET  /api/finance/recurring-payments` — список (активные сверху, по дате).
  - `GET  /api/finance/recurring-payments/upcoming` — ближайшие списания.
  - `POST /api/finance/recurring-payments` — создать.
  - `PUT  /api/finance/recurring-payments/:id` — правка (пересчитывает `next_run_at`).
  - `PUT  /api/finance/recurring-payments/:id/active` — пауза/возобновление.
  - `DELETE /api/finance/recurring-payments/:id` — удалить.
- **Автосоздание транзакции** — `RecurringScheduler` (по образцу
  `notifications/scheduler`): тик раз в минуту; в продакшене BullMQ/Valkey
  (очередь `puls-recurring`), при недоступности Valkey или без `REDIS_URL` —
  таймер в процессе. Баланс счёта обновляется существующим
  `TransactionsService.create` (та же `$transaction`, что и у ручной транзакции).
- **Идемпотентность**: `next_run_at` забирается условным `updateMany` (CAS по
  значению `next_run_at`), поэтому повторный тик и перезапуск не создают дубль.
- **Напоминание за 1 день** — через `NotificationDispatcher`
  (`sendRecurringReminder`), канал берётся из правила `payments`
  (`web_push`/`email`), текст — `buildRecurringReminder`. Повторная отправка
  исключена полем `reminded_for`.
- **UI**: секция «Регулярные платежи» на `/finance`
  (`apps/web/src/components/recurring-section.tsx`): список платежей, ближайшие
  списания, форма создания (название, сумма, тип, счёт, категория,
  периодичность, день), пауза/возобновление и удаление.
- **Экспорт/удаление данных**: `recurring_payments` добавлена в реестр выгрузки
  (`account/data-registry.ts`); удаление аккаунта подхватывает таблицу
  автоматически по `user_id`.

## Переменные окружения (новые)

В `.env.example` не дублируются (правка общих файлов вне задачи), но читаются
из окружения:

- `RECURRING_TICK_MS` — период тика планировщика, по умолчанию `60000`.
- `RECURRING_SCHEDULER` — `off` выключает автостарт, по умолчанию `on`.
- `REDIS_URL` — общий с планировщиком уведомлений; без него планировщик работает
  по таймеру в процессе.

## Миграция

`apps/api/prisma/migrations/20261001135900_recurring_payments` — таблица
`recurring_payments`, индекс `(user_id, active, next_run_at)` и внешние ключи на
`users`, `accounts` (каскад) и `categories` (SET NULL).

## Тесты

- `packages/shared/test/recurring.test.ts` — расчёт дат: конец месяца
  (31-е → 30/28/29), високосный февраль, еженедельный/ежегодный ритм, переходы
  DST (`America/New_York`, весна/осень), схемы API (23 теста).
- `apps/api/test/recurring.integration.test.ts` — CRUD, пауза/возобновление,
  изоляция по пользователю, автосоздание транзакции и сдвиг баланса,
  идемпотентность повторного тика, напоминание за 1 день без повторов,
  игнорирование платежей на паузе (PostgreSQL, схема `puls_test`).
- `apps/web/e2e/recurring.spec.ts` — создание, пауза/возобновление и удаление
  регулярного платежа через интерфейс.
