# Фаза 3 — публичный профиль (ТЗ §3.7)

Блок A: страница `ваш-домен/@nickname`, модель профиля, карточки с приватностью
и редактор профиля. Подписки, лента, реакции и жалобы — блоки B/C, здесь только
потребление факта подписки через тонкий хелпер.

## Модель данных

- **Profile** (`profiles`): одна строка на пользователя — `bio` (до 280),
  `avatar_url`, `cover_url`.
- **ProfileCard** (`profile_cards`): одна карточка каждого типа на пользователя
  (уникальная пара `user_id + type`):
  - `type`: `savings | checkin_streak | avg_mood | achievements | goals | html_page`;
  - `visibility`: `public | subscribers | private` (по умолчанию `private`);
  - `mode`: `percent | amount` (по умолчанию `percent`); сумма осмысленна только
    для `savings` и `goals`, у остальных схлопывается в `percent`;
  - `title`, `html` (для `html_page`, до 20 000 символов), `position`.
- Видимость самого профиля — существующее поле `User.profileVisibility`.

Миграция: `20261001170500_public_profile` (только `profiles` и `profile_cards`;
создана отдельно от моделей соцслоя блока B).

## API

- `GET /api/profile` (SessionGuard) — свой профиль. При первом обращении создаёт
  строку профиля и скрытые карточки по умолчанию (5 типов, `percent`).
- `PUT /api/profile` (SessionGuard) — описание, аватар, обложка и полный набор
  карточек (`ProfileUpdateSchema`). Типы, которых нет в теле, удаляются.
- `GET /api/public/profiles/:nickname` — публичный просмотр без входа.
  - `private` профиль → 404 (существование не раскрывается);
  - карточки `private` не отдаются никому, `subscribers` — только подписчику и
    владельцу. Сессия смотрящего учитывается необязательно.
- Данные карточек собираются из существующих сервисов: `GoalsService`
  (накопления, цели), `AchievementsService` (стрик, бейджи), `StatsService`
  (среднее настроение за месяц).
- HTML-карточка очищается `sanitizeCardHtml` (ТЗ §3.8).

## Web

- `apps/web/src/components/profile-editor.tsx` — редактор в `/app/profile`:
  описание, ссылки на аватар/обложку, приватность и режим каждой карточки.
- `apps/web/src/app/u/[nickname]/page.tsx` — публичная страница. Символ `@`
  зарезервирован Next за parallel routes, поэтому короткий адрес `/@nickname`
  отдаётся rewrite'ом в `next.config.mjs` → `/u/:nickname`.
- Все строки — через `lib/i18n.ts` (`profile.*`), ru и en.

## Тесты

- `packages/shared/test/profile.test.ts` — чистая логика видимости, режима и
  очистки HTML.
- `apps/api/test/profile.integration.test.ts` — свой профиль, приватность,
  изоляция между пользователями, режим «проценты/сумма». Позитивный кейс
  подписчика включается, когда таблица `follows` (блок B) уже мигрирована.
- `apps/web/e2e/profile.spec.ts` — регистрация → редактор → анонимный гость на
  `/@nickname` видит только публичную карточку.

## Реестр данных

`profiles` и `profile_cards` добавлены в `data-registry.ts` (выгрузка), поэтому
интеграционный тест «каждая таблица с `user_id` покрыта» проходит.

## Что осталось (другие блоки)

- `isSubscriber` в `profile/subscriptions.ts` использует `prisma.follow` через
  тонкий хелпер; пока таблица `follows` не мигрирована, подписки считаются
  отсутствующими (`TODO(block B)`).
- Лента, реакции, комментарии, жалобы и кнопка «Поделиться» — блоки B/C.
