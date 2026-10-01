# Фаза 5, блок H — челленджи

Реализация ТЗ §4 (пункт «Челленджи», приоритет P2): «30 дней без доставки»,
«Неделя без импульсных покупок» и свои испытания. Можно позвать друзей по коду
или из подписок и видеть общий рейтинг — только никнеймы и счёт; приватные
данные участников не раскрываются.

## Модель (ТЗ §7)

- `Challenge` (id, `owner_id`, title, kind `no_spend_category|streak_checkin|custom`,
  `duration_days`, `start_date`, visibility `private|friends|public`,
  `invite_code` уникальный).
- `ChallengeParticipant` (`challenge_id`, `user_id`, `joined_at`); пара
  (challenge_id, user_id) уникальна — повторное вступление идемпотентно.
- `ChallengeCheck` (`challenge_id`, `user_id`, `date`, `ok`) — ежедневная отметка
  «держусь», одна на (челлендж, пользователь, день). Для
  kind = `streak_checkin` прогресс (дни выдержки и серия) считается
  автоматически по этим отметкам.

Миграция — `apps/api/prisma/migrations/20261001180000_challenges`. Таблицы с
колонкой `user_id` (`challenge_participants`, `challenge_checks`) добавлены в
`apps/api/src/account/data-registry.ts` — покрыты выгрузкой и тестом реестра.
`challenges` содержит `owner_id` (как `families`), поэтому в реестр не входит.

## Эндпоинты (префикс `/api/challenges`, все под `SessionGuard`)

| Метод | Путь | Кто | Назначение |
| --- | --- | --- | --- |
| GET | `/` | авторизованный | Мои челленджи (веду и участвую) с прогрессом |
| POST | `/` | авторизованный | Создать челлендж (ведущий сразу участник), вернуть код |
| GET | `/:id` | видимый зрителю | Челлендж с составом и моим прогрессом |
| PUT | `/:id` | ведущий | Правка названия и видимости |
| DELETE | `/:id` | ведущий | Удалить челлендж вместе с отметками |
| POST | `/join` | авторизованный | Вступить по коду (идемпотентно) |
| POST | `/:id/check` | участник | Отметка «держусь»/«сорвался» на день |
| GET | `/:id/leaderboard` | участник | Рейтинг: место, никнейм, дни выдержки, серия |
| GET | `/:id/invite-candidates` | ведущий | Подписки, которых можно позвать |
| POST | `/:id/invite` | ведущий | Позвать подписку по никнейму |

Ошибки в едином формате `{ code, message }`: `validation_error`, `unauthorized`,
`challenge_not_found` (404), `challenge_forbidden` (403), `invite_not_found`
(404), `challenge_full` (409), `date_out_of_range` (400), `invalid_start_date` /
`invalid_date` (400), `user_not_found` (404), `not_following` (403).

## Приватность (ТЗ §4)

- Видимость: участник видит всегда; `private` — только участники, `friends` —
  подписчики владельца (существующий `Follow`, проверка `isFollowing`),
  `public` — все авторизованные. Чужой/невидимый идентификатор даёт `404`.
- Состав и рейтинг доступны только участникам: постороннему — `404`.
- В рейтинг и состав попадают только никнеймы, счёт (дни выдержки) и серия —
  почта, суммы и прочие приватные данные не раскрываются.
- Приглашать можно только тех, на кого ведущий сам подписан (`not_following`
  иначе); приглашение идемпотентно.

## Чистые функции (`@puls/shared/src/challenges.ts`)

- `CHALLENGE_TEMPLATES` — три шаблона из ТЗ §4 с видом и длительностью.
- `challengeEndDate` / `challengeDayNumber` / `isDayInChallenge` — окно челленджа.
- `challengeHeldDays` — дни выдержки (уникальные ok-дни внутри окна).
- `challengeCurrentStreak` — текущая серия (с сегодня, либо со вчера).
- `challengeProgressPercent` — прогресс 0..100.
- `challengeCheckedToday`, `challengeLeaderboard` (сортировка: дни выдержки →
  серия → никнейм; места 1..N), `canViewChallenge`.
- Zod-схемы `ChallengeCreateSchema`, `ChallengeUpdateSchema`, `ChallengeJoinSchema`,
  `ChallengeCheckSchema`, `ChallengeInviteSchema` и DTO ответов.

## Web

- `/challenges` — список челленджей, шаблоны, создание, вступление по коду, код
  приглашения с копированием, отметка «держусь», рейтинг и приглашение друзей.
- Пункт навигации `app.nav.challenges` в `components/app-shell.tsx`
  (`data-testid="nav-challenges"`).
- Клиент `lib/challenges-client.ts` через `authFetch`.
- Все строки интерфейса — в `src/lib/i18n.ts` (ru/en, одинаковые ключи).

## Тесты

- Unit: `packages/shared/test/challenges.test.ts` (18 тестов: шаблоны, схемы,
  окно, дни выдержки, серия, прогресс, рейтинг, видимость).
- API: `apps/api/test/challenges.integration.test.ts` (13 тестов против
  PostgreSQL: CRUD, вступление по коду, приватность, отметки, рейтинг,
  приглашение из подписок).
- E2E: `apps/web/e2e/challenges.spec.ts` (два пользователя: создать, вступить по
  коду, отметка, рейтинг).
