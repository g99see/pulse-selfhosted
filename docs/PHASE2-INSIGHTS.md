# Фаза 2. Инсайты на правилах и недельный разбор (ТЗ §3.5)

Рекомендации на основе данных пользователя без медицинских диагнозов: движок
читает траты, чек-ины и бюджеты из уже готовых сервисов и формирует текстовые
наблюдения. AI-разбор по запросу — отдельная задача (ТЗ §3.9, Фаза 4) и здесь
намеренно не реализован.

## Что сделано

### Чистые правила — `packages/shared/src/insights.ts`

Без побочных эффектов и обращений к БД, поэтому используются и API, и web, а
тесты быстрые. Unit-тесты: `packages/shared/test/insights.test.ts` (24 теста,
TDD: сначала RED, затем GREEN).

| Правило | Функция | Текст (ключ i18n) |
| --- | --- | --- |
| Траты на категорию выросли на N% за неделю | `categorySpendRiseCandidates` (через `percentChange`) | `insights.text.categorySpendUp` |
| Три дня подряд энергия ниже 2 | `lowEnergyStreakCandidates` | `insights.text.lowEnergyStreak` |
| Настроение выше в дни со спортом (по тегу) | `moodWithSportCandidate` | `insights.text.moodWithSport` |
| Превышение бюджета | `budgetExceededCandidates` | `insights.text.budgetExceeded` |
| Предложение недели: бюджет на категорию | `budgetSuggestionCandidate` | `insights.text.budgetSuggestion` |
| Защитное правило: настроение 1 дольше 5 дней | `wellbeingConcernCandidates` | `insights.text.wellbeingConcern` |

Пороговые значения: рост категории ≥ 20% при сумме ≥ 300; серия низкой энергии
≥ 3 дней; разница настроения со спортом ≥ 0.5 при ≥ 3 днях со тегом; тревожный
сигнал — **6 и более** дней подряд (буквально «более 5 дней» из ТЗ §3.5).

Отбор недельного разбора — `selectWeeklyInsights`: 3 самых весомых инсайта и
1 предложение. Оценки влияют на показ: `insightTypePenalty`, `hiddenInsightTypes`
(тип прячется при ≥ 2 «не полезно» без одобрений), `rankInsights`,
`feedbackStatsFromRows` (сворачивает `groupBy` по типу и оценке).

### Справочник поддержки — там же

`SUPPORT_RESOURCES` покрывает RU, UA, KZ, BY, US, GB, DE и общий международный
(`INT`). Страна определяется по часовому поясу (`countryFromTimezone`), к
контактам страны добавляется международный (`supportResourcesFor`). В записях
хранятся только ключи i18n, телефон и ссылка; формулировки без диагнозов и
обещаний лечения (проверяется тестом).

| Страна | Служба | Телефон |
| --- | --- | --- |
| RU | Телефон доверия | 8-800-100-49-94 |
| UA | LifeLine Ukraine | 7333 |
| KZ | Контакт-центр 111 | 111 |
| BY | Телефон доверия 133 | 133 |
| US | 988 Suicide & Crisis Lifeline | 988 |
| GB | Samaritans | 116 123 |
| DE | Telefonseelsorge | 0800 111 0 111 |
| INT | Find a Helpline | — |

### Модель `Insight` и миграция

`apps/api/prisma/migrations/20261001135645_insights` создаёт таблицу
`insights`. Поля: `user_id`, `type`, `text_key`, `params` (JSONB — параметры
i18n), `source` (`rule` | `weekly`), `period_key` (ключ дня или ISO-недели),
`action` (JSONB — действие предложения), `applied_at`, `feedback`
(`useful` | `not_useful`), `feedback_at`, `created_at`. Уникальный индекс
`(user_id, type, period_key)` делает генерацию идемпотентной.

### API — `apps/api/src/insights`

- `GET /api/insights` — лента (генерирует свежие за сегодня), при тревожном
  инсайте добавляет `support` и `country`.
- `GET /api/insights/latest` — последний инсайт для блока на главной.
- `GET /api/insights/weekly` — последний недельный разбор.
- `POST /api/insights/:id/feedback` `{ feedback }` — оценка «полезно / нет».
- `POST /api/insights/:id/apply` — применяет предложение, создаёт бюджет через
  `BudgetsService` (месячный лимит = недельный × 30 / 7).
- `POST /api/insights/generate` — ручная генерация (идемпотентно).

Всё под `SessionGuard`, строгая изоляция по `userId` (тест: чужой инсайт —
404, анонимный — 401).

Движок только **читает** существующие сервисы: `StatsService.report` (текущая и
прошлая неделя), `CheckinsService.list`, `BudgetsService.list`.

### Недельный разбор — `weekly.scheduler.ts`

По образцу планировщика уведомлений: тик раз в минуту, BullMQ/Valkey в
продакшене, иначе таймер в процессе. Разбор собирается в **воскресенье 19:00 по
часовому поясу пользователя** (`weeklyReportSlot` / `isWeeklyReportDue`).
Идемпотентно по ISO-неделе: повторный тик и рестарт не создают дублей.
Уведомление отправляется существующим `NotificationDispatcher` типом
`weekly_report` (канал — правило пользователя, по умолчанию email).

Новые переменные окружения (в `.env.example` не вносились по условию задачи):
`INSIGHTS_TICK_MS` (по умолчанию 60000), `INSIGHTS_SCHEDULER=off` — отключить
автостарт.

### Web

- `/insights` — лента: оценка «Полезно / Не полезно», кнопка «Применить» у
  предложения, блок служб поддержки при тревожном сигнале.
- Блок «Последнее наблюдение» на `/app`.
- Пункт навигации «Рекомендации».
- Все строки — в `apps/web/src/lib/i18n.ts` (ru + en, одинаковые ключи);
  тест на зашитые строки проходит.

## Проверки

- `packages/shared`: unit-тесты правил (24) — зелёные.
- `apps/api`: `test/insights.integration.test.ts` — 10 интеграционных тестов
  против PostgreSQL (правила, применение, защитное правило, оценки, недельный
  разбор, изоляция).
- `apps/web`: `e2e/insights.spec.ts` — регистрация → траты → бюджет →
  превышение → оценка → применение → блок на главной.
- `pnpm lint`, `typecheck`, `build`, `license:check` — см. итог прогона.

## Что не сделано

- AI-разбор по запросу («Проанализировать месяц») — ТЗ §3.9, Фаза 4.
- Telegram-канал для недельного отчёта: тип `weekly_report` уже есть в правилах,
  но реальная отправка в Telegram — задача модуля уведомлений (ТЗ §3.6).
