# Фаза 2. Стрики и достижения (ТЗ v2 §4)

## Итог

Достижения — **декларативный каталог** в `@puls/shared` (**153 записи**, 107 метрик,
группы `checkin` / `finance` / `activity` / `special`, из них 18 скрытых). Новое
достижение добавляется **одной записью каталога** на существующей метрике — без
правки логики; новая метрика — новый ключ в реестре и функция в `apps/api`.
Никаких зависимостей от соцфункций (проверяется тестом).

## Стрики (ТЗ §4)

Серия дней подряд считается по календарным дням в часовом поясе пользователя.
Пропуск дня сбрасывает серию; если сегодня чек-ина ещё нет, серия не обнуляется
(день ещё не засчитан). Переходы на летнее время и границы суток учитываются
через `Intl`-форматирование зон (`packages/shared/src/achievements.ts`:
`computeStreak`, `streakFromInstants`, `nextStreakMilestone`).

## Каталог (декларативный, `packages/shared/src/achievement-catalog.ts`)

- Одна строка `ROWS` = одно достижение: `code`, группа, ключ `metric`, иконка
  (эмодзи), `rarity` (`common`/`rare`/`epic`/`legendary`), скрытость, пороги
  уровней и тексты ru+en.
- Уровни выводятся из числа порогов: 1 → `[gold]`, 2 → `[silver, gold]`,
  3 → `[bronze, silver, gold]`; пороги строго возрастают.
- Группы: `checkin` (серии, полнота, вода/шаги/сон, утренние/вечерние, по дням
  недели), `finance` (операции, бюджеты, сверка, импорт, накопления — только
  через **обобщённые** метрики операций/счетов/бюджетов, без названий категорий и
  магазинов), `activity` (дни и серии использования, привычки, модули),
  `special` (+ `hidden: true` — «особые и скрытые»: ночные/ранние чек-ины,
  возврат настроения, год/полгода без пропусков, 29 февраля, Новый год, пятница
  13-е, дата-палиндром и др.).
- Тексты i18n: `achievements.<код>.title|description`; `{n}` заменяется порогом
  уровня. Веб подмешивает их в словарь через `achievementMessages(locale)`
  (`Object.assign(MESSAGES.ru/en, achievementMessages(...))`).
- `ACHIEVEMENT_METRIC_EVENTS` — ключ метрики → события, после которых она могла
  измениться; `ACHIEVEMENT_METRICS` — полный набор ключей.

## Метрики (`apps/api/src/achievements/metrics.ts`)

- `MetricData` — ленивые мемоизированные выборки данных пользователя: десятки
  метрик не множат запросы (одна выборка на модель за пересчёт).
- `METRICS: Record<AchievementMetric, MetricFn>` — тип гарантирует, что у каждой
  метрики каталога есть функция; тест `metrics.test.ts` проверяет паритет ключей.

## API (`apps/api/src/achievements`)

Всё под `SessionGuard`, строгая изоляция по пользователю.

- `GET /api/achievements` — ленивый пересчёт и список с группами, уровнями,
  прогрессом до следующего порога и маскировкой скрытых (до получения наружу не
  отдаются ни значение, ни пороги, ни прогресс).
- `GET /api/achievements/streak` — только серия.
- `POST /api/achievements/backfill` (admin) — тихий пересчёт всех без уведомлений.
- `AchievementsService`:
  - `evaluate(userId, metrics?, {silent})` — считает метрики и выдаёт заслуженные
    уровни; `onEvent(userId, event)` — только метрики, зависящие от события, и
    глотает сбой, чтобы не ломать вызывающего.
  - `grant(userId, code, level)` — **идемпотентная** выдача через
    `INSERT … ON CONFLICT DO NOTHING`; защита от дублей и гонки — уникальный
    индекс БД `(user_id, code, level)`.
  - `syncCatalog()` — зеркалит каталог в таблицу `achievements` (upsert).
  - `catalogHash()` + `backfillIfNeeded()` / `backfillAll()` — тихий пересчёт.

Проверка достижений вызывается:
1. лениво при чтении `/api/achievements`;
2. из `CheckinsService.create` (`await this.achievements.onEvent(userId, 'checkin')`);
3. финансовые сервисы (операции, счета, бюджеты, сверка, импорт), цели и привычки
   шлют `InternalEvents.emit('achievement.check', { userId, event })` — без циклов
   модулей (`apps/api/src/common/internal-events.ts`).

## Уведомления (только Telegram/Discord, ТЗ §4)

- При выдаче по событию сервис шлёт `InternalEvents.emit('achievement.earned', …)`.
- `AchievementAlerts` (`apps/api/src/notifications/achievement-alerts.ts`) слушает
  шину и ставит сообщение в outbox через `NotificationDispatcher.notifyAchievementEarned`
  → активные каналы **Telegram и Discord** (web push не задействован).
- Тихий пересчёт (`backfill`, `{silent:true}`) уведомлений не шлёт.
- Тексты — `buildAchievementEarned` (ru/en, уровень bronze/silver/gold).

## Пересчёт старых данных (backfill)

- Миграция `20261007120000_achievements_v3` (написана вручную, идемпотентна,
  `IF NOT EXISTS`): добавляет `level` в `user_achievements`, переводит старые
  коды на новые с уровнями, меняет уникальный индекс на `(user_id, code, level)`,
  добавляет `instance_settings.achievements_catalog_hash`.
- При старте приложения `backfillIfNeeded()` сравнивает отпечаток каталога и, если
  он изменился, тихо пересчитывает всех пачками по 100 (без уведомлений).
- Разовый ручной прогон: `POST /api/achievements/backfill` (admin) или CLI
  `node apps/api/dist/achievements/backfill.cli.js`.

## UI (`apps/web`)

- `/achievements` — группы в порядке `checkin`/`finance`/`activity`/`special`;
  карточка показывает иконку, название и описание из каталога, печати уровней
  (бронза/серебро/золото) с датами, прогресс-бар до следующего порога.
- Скрытые и неполученные достижения маскируются (`???`), без утечки значения и
  прогресса.
- Карточка серии с прогресс-баром до следующей награды, конфетти при получении.
- Строки интерфейса — только в `apps/web/src/lib/i18n.ts` (ru + en); тексты
  достижений подмешиваются из каталога.

## БД (`apps/api/prisma/schema.prisma`)

- `Achievement` — зеркало каталога (код, JSON-условие, позиция).
- `UserAchievement` — `(user_id, code, level, earned_at)`, уникальность
  `(user_id, code, level)`. Таблица уже зарегистрирована в
  `apps/api/src/account/data-registry.ts`; новых пользовательских таблиц нет.

## Проверки

- `pnpm --filter @puls/shared test` — валидность каталога (уникальные коды,
  метрики существуют, пороги возрастают, паритет ru/en, нет соцзависимостей) и
  логика стриков.
- `pnpm --filter @puls/api test` — юнит `src/achievements/metrics.test.ts`
  (реестр метрик, расчёты), `achievements.service.test.ts` (grant, маскировка,
  выдача по метрике, backfill) и интеграционные
  `test/achievements.integration.test.ts` (стрики, выдача по событиям, уровни,
  идемпотентность и гонка, backfill, изоляция).
- `pnpm --filter @puls/web test`, `pnpm --filter @puls/web e2e` (`e2e/achievements.spec.ts`).
- `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.

## Не сделано / вне этой задачи

- Показ достижений в публичном профиле — не входит (соцфункции удаляются).
- Веб-push для достижений не делаем: уведомления только Telegram/Discord (ТЗ §4).
- Соцзависимые достижения («пригласи друга» и т. п.) отсутствуют намеренно.
