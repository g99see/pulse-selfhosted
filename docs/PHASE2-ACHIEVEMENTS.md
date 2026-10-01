# Фаза 2. Стрики и достижения (ТЗ §2, §4)

## Что сделано

- **Стрики чек-инов** (ТЗ §4): серия дней подряд считается по календарным дням в
  часовом поясе пользователя. Пропуск дня сбрасывает серию; если сегодня чек-ина
  ещё нет, серия не обнуляется (день ещё не засчитан). Переходы на летнее время и
  границы суток учитываются через `Intl`-форматирование зон.
- **Достижения** (бейджи): первый чек-ин; серии 7/30/100 дней; первая транзакция;
  первый закрытый бюджет (прошедший месяц без превышения лимита); цели — первая
  цель, половина (50%) и завершение (100%).
- **Модели БД**: `Achievement` (код + JSON-условие) и `UserAchievement`
  (`user_id`, `code`, `earned_at`, уникальная пара `user_id + code` —
  идемпотентность и защита от гонки на уровне БД). Миграция
  `20261001140024_achievements`.

## Чистая логика в shared (`packages/shared/src/achievements.ts`)

Без побочных эффектов, переиспользуется API и web:

- `computeStreak(dayKeys, todayKey)` / `streakFromInstants(instants, timezone, now)`
  — текущий и самый длинный стрик, признак «сегодня отмечено».
- `evaluateAchievements(context)` — коды бейджей, условия которых выполнены
  (по числу чек-инов, стрику, транзакциям, закрытым бюджетам).
- `isBudgetMonthClosedWithinLimit(...)` — «месяц без превышения».
- `nextStreakMilestone(streak)` — ближайший непройденный порог.
- Каталог `ACHIEVEMENTS` / `ACHIEVEMENT_CODES` и контракты DTO.

Unit-тесты `packages/shared/test/achievements.test.ts` покрывают границы дня,
переходы на летнее/зимнее время (`America/New_York`, `Europe/Berlin`,
`Europe/Moscow`), сброс серии и пороги.

## API (`apps/api/src/achievements`)

Всё под `SessionGuard`, строгая изоляция по пользователю.

- `GET /api/achievements` — ленивая проверка условий, затем список бейджей с
  прогрессом и текущая серия: `{ achievements: [...], streak: {...} }`.
- `GET /api/achievements/streak` — только серия (для карточки чек-ина на /app).
- `AchievementsService.award(userId, code)` — **публичный метод для других
  модулей** (цели вызывают его для `first_goal` / `goal_half` / `goal_complete`).
  Идемпотентен: повторная выдача и гонка двух вызовов дают ровно одну запись
  (P2002 → `false`). `AchievementsModule` экспортирует сервис.

Проверка условий вызывается:
1. лениво при чтении `/api/achievements` (и `/streak` не пишет — только считает);
2. одной строкой из `CheckinsService.create` после записи чек-ина
   (`await this.achievements.evaluate(userId).catch(() => undefined)` — сбой не
   ломает чек-ин).

Каталог `Achievement` заполняется в `onModuleInit` (upsert, идемпотентно).

## UI (`apps/web`)

- `/achievements` — сетка бейджей по группам (чек-ины, финансы, цели):
  полученные/нет, дата получения, прогресс до порога; карточка серии с
  прогресс-баром до следующей награды.
- Карточка чек-ина на `/app` показывает текущую серию (`checkin-streak`) и
  запускает анимацию конфетти при получении нового бейджа.
- Конфетти — CSS-анимация (`apps/web/src/components/confetti.tsx` + стили в
  `globals.css`), уважает `prefers-reduced-motion` (слой скрывается).
- Строки интерфейса — только в `apps/web/src/lib/i18n.ts` (ru + en).

## Переменные окружения

Новых переменных нет.

## Проверки

- `pnpm --filter @puls/shared test` — чистая логика (юнит).
- `pnpm --filter @puls/api test` — интеграционные тесты
  `apps/api/test/achievements.integration.test.ts` (стрики, бейджи, award,
  идемпотентность и гонка, изоляция).
- `pnpm --filter @puls/web test`, `pnpm --filter @puls/web e2e` (спек
  `e2e/achievements.spec.ts`).
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm license:check`.

## Не сделано / вне Фазы 2

- Показ достижений в публичном профиле — Фаза 3.
- Событийная шина для целей: интеграция выполняется прямым вызовом
  `AchievementsService.award` из модуля целей (`apps/api/src/goals`).
