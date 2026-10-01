// SPDX-License-Identifier: AGPL-3.0-or-later
# Фаза 3, блок B. Подписки, лента, реакции и комментарии (ТЗ §3.7)

## Что сделано

- **Подписки**: направленные рёбра графа «кто на кого подписан», уникальная пара
  `(follower_id, following_id)` — повторная подписка идемпотентна.
- **Посты ленты**: создаются автоматически при получении достижения, создании
  цели и пересечении вех прогресса цели (25/50/75/100%). В посте хранится
  компактный `payload` (код бейджа, id/название цели, процент) — суммы в ленте
  не публикуются.
- **Реакции**: фиксированный набор эмодзи (`👍 🔥 🎉 💪 ❤️`), уникальность
  `(post_id, user_id, emoji)`, повторное нажатие снимает реакцию.
- **Комментарии**: не длиннее 500 символов, удалять может автор комментария или
  владелец поста.
- **Приватность**: видимость поста (public | subscribers | private) ограничена
  приватностью профиля владельца — итоговая видимость есть «строжайший» из
  двух уровней. Приватный профиль не отдаёт посты даже подписчикам.
- **Уведомление reactions**: владельцу поста на реакцию/комментарий через
  `NotificationDispatcher` (уважает общий переключатель уведомлений).

## Модели БД (`apps/api/prisma/schema.prisma`)

- `Follow` (`follows`): `follower_id`, `following_id`, `created_at`,
  уникальная пара `(follower_id, following_id)`, индекс по `following_id`.
- `Post` (`posts`): `user_id`, `type` (achievement | goal | milestone),
  `payload` (JSONB), `visibility` (default `subscribers`), `created_at`.
  Индексы `(user_id, created_at)` и `(created_at, id)` — под курсорную ленту.
- `Reaction` (`reactions`): `post_id`, `user_id`, `emoji`, уникальность
  `(post_id, user_id, emoji)`.
- `Comment` (`comments`): `post_id`, `user_id`, `body`, `created_at`.

Миграция: `20261001143916_phase3_social`. Она создавалась в общем worktree, где
параллельно менялись таблицы модерации/жалоб, поэтому SQL намеренно урезан до
DDL этого блока.

## Чистая логика в shared (`packages/shared/src/social.ts`)

Схемы и типы, общие для API и web, без побочных эффектов:

- `CommentCreateSchema` (trim, 1–500 символов), `ReactionCreateSchema`
  (эмодзи только из `REACTION_EMOJIS`), `FeedQuerySchema` (курсор + limit 1–50,
  по умолчанию 20).
- `canView(visibility, isOwner, isFollower)` и
  `effectiveVisibility(postVisibility, profileVisibility)` — правила видимости.
- `encodeFeedCursor` / `parseFeedCursor` — устойчивый курсор «createdAt + id».
- `summarizeReactions(rows, viewerId)` — агрегация реакций по эмодзи.

Unit-тесты: `packages/shared/test/social.test.ts`.

## API (`apps/api/src/social`)

Всё под `SessionGuard`.

- `POST /api/follows/:nickname` — подписаться (нельзя на себя → 400
  `cannot_follow_self`, неизвестный ник → 404). Возвращает состояние.
- `DELETE /api/follows/:nickname` — отписаться (204).
- `GET /api/follows/followers` / `GET /api/follows/following` — списки подписок.
- `GET /api/follows/:nickname` — состояние подписки.
- `GET /api/feed?cursor=&limit=` — посты своих подписок + свои, с пагинацией
  курсором; невидимые посты отбрасываются.
- `POST /api/posts/:postId/reactions` — поставить реакцию (идемпотентно).
- `DELETE /api/posts/:postId/reactions/:emoji` — снять реакцию (204).
- `GET /api/posts/:postId/comments` — комментарии.
- `POST /api/posts/:postId/comments` — добавить (лимит 20/мин, 429
  `rate_limited`).
- `DELETE /api/comments/:id` — удалить (автор комментария или владелец поста,
  иначе 403).

### Хелпер `isFollowing`

`apps/api/src/social/is-following.ts` экспортирует
`isFollowing(prisma, viewerId, ownerId)` — им закрывают карточки «только
подписчикам» (использует блок A — публичный профиль). Также доступен как метод
`SocialService.isFollowing`.

### Создание постов

`SocialPostsService` вынесен в листовой `SocialPostsModule`, чтобы достижения
(`AchievementsModule`) и цели (`GoalsModule`) могли импортировать его без
циклических зависимостей Nest (`NotificationsModule → TelegramModule →
CheckinsModule → AchievementsModule`).

## Web (`apps/web`)

- Экран `/feed` — `src/app/(app)/feed/page.tsx`; ссылка в навигации
  (`app.nav.feed`).
- Компонент поста — `src/components/post-card.tsx`: реакции-эмодзи и блок
  комментариев.
- Кнопка подписки — `src/components/follow-button.tsx` (для публичного профиля;
  подключает блок A).
- Клиент API — `src/lib/social-client.ts`.
- Строки — только через `src/lib/i18n.ts` (ru + en, одинаковые ключи).

## Выгрузка данных

Таблицы `posts`, `reactions`, `comments` добавлены в `EXPORT_TABLES`
(`apps/api/src/account/data-registry.ts`). Таблица `follows` колонки `user_id`
не содержит: граф подписок удаляется каскадом при удалении пользователя.

## Тесты

- Unit shared: `packages/shared/test/social.test.ts`.
- Интеграционные API: `apps/api/test/social.integration.test.ts` — изоляция,
  приватность (профиль/пост), запрет подписки на себя, идемпотентность реакций,
  удаление комментариев, лимит частоты, создание постов из целей и вех.
- E2E Playwright: `apps/web/e2e/social.spec.ts` — лента, реакция, комментарий.

## Что не сделано / ограничения

- Кнопка подписки не подключена к странице `/u/[nickname]` — её интегрирует
  блок A (публичный профиль).
- Уведомление reactions уважает только общий переключатель уведомлений, без
  отдельного правила `NotificationRule` по типу.
