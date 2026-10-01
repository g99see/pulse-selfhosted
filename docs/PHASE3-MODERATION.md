# Фаза 3, блок E — жалобы и модерация

ТЗ: §2 (роли), §3.7 «Публичный профиль → жалоба на профиль или контент»,
§3.8 «HTML-страница → ручная модерация по жалобам», §6 (ограничение частоты).

## Что сделано

- Модель `Report` (`reports`): жалоба любого вошедшего на профиль, пост,
  комментарий или HTML-страницу.
- Модель `ModerationAction` (`moderation_actions`): журнал решений модераторов.
- Модель `ContentFlag` (`content_flags`): флаг скрытия цели — одна запись на
  пару `(target_type, target_id)`.
- Приём жалоб: `POST /api/reports`, очередь и решения под ролью moderator/admin.
- `RolesGuard` + декоратор `@Roles(...)` — общий механизм проверки роли.
- `ModerationService.isHidden(targetType, targetId)` — точка интеграции для
  профиля, ленты и HTML-страницы.
- Web: компонент `ReportButton` с диалогом, страница `/moderation`, ссылка в
  навигации для ролей moderator/admin, строки в `i18n.ts` (ru/en).
- Таблицы с `user_id` учтены в реестре экспорта/удаления.

## Схема БД

| Таблица | Назначение | `user_id` |
| --- | --- | --- |
| `reports` | жалобы (автор = `reporter_id` → `user_id`) | да, автор жалобы |
| `moderation_actions` | журнал решений (автор = `moderator_id` → `user_id`) | да, модератор |
| `content_flags` | скрытие цели, ключ `(target_type, target_id)` | нет |

Перечисления: `report_target_type` (`profile|post|comment|html_page`),
`report_reason` (`spam|abuse|phishing|illegal|other`),
`report_status` (`open|resolved|dismissed`),
`moderation_action_kind` (`hide|unhide|ban_html|unban_html|dismiss`).

Реестр (`apps/api/src/account/data-registry.ts`):
- `reports` — выгружается (жалобы пользователя — его данные);
- `moderation_actions` — исключён (внутренний журнал модерации экземпляра).
- Удаление аккаунта идёт по `information_schema` (все таблицы с `user_id`), плюс
  `onDelete: Cascade` по автору — жалобы и действия модератора удаляются вместе
  с пользователем.

## API

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| POST | `/api/reports` | любой вошедший | отправить жалобу |
| GET | `/api/moderation/reports?status=` | moderator, admin | очередь жалоб (фильтр по статусу) |
| POST | `/api/moderation/reports/:id/resolve` | moderator, admin | решение: `{ action, note? }` |
| GET | `/api/moderation/actions` | moderator, admin | журнал действий |

Правила приёма жалоб (`ModerationService.createReport`):
- нельзя жаловаться на собственный профиль (`report_self`, 400);
- дубль того же автора на ту же цель, пока жалоба `resolved`/`open`,
  блокируется (`report_duplicate`, 409); после `dismissed` жалобу можно подать снова;
- ограничение частоты: 10 жалоб в час на пользователя (`rate_limited`, 429).

Решения: `hide`/`ban_html` ставят флаг скрытия, `unhide`/`unban_html` снимают,
`dismiss` закрывает жалобу без изменения видимости. Каждое решение — запись в
`moderation_actions` и обновление жалобы в одной транзакции. Повторное решение
по закрытой жалобе — `report_closed` (409).

`RolesGuard` читает роль из `request.user` (заполняет `SessionGuard`), поэтому
на обработчиках порядок такой: `@UseGuards(SessionGuard, RolesGuard)`.

## Точки интеграции `isHidden`

`ModerationService.isHidden(targetType, targetId)` — единая проверка «цель
скрыта модератором». Другие блоки должны фильтровать выдачу так:

- **Публичный профиль** (`apps/api/src/profile/public-profiles.controller.ts` /
  `profile.service.ts`): перед отдачей профиля проверять
  `await moderation.isHidden('profile', profile.userId)` и отдавать `404`,
  если скрыт. Для этого `ProfileModule` импортирует `ModerationModule`, а
  сервис получает `ModerationService` в конструкторе.
- **Лента постов** (`apps/api/src/social/social-posts.service.ts`): при выборке
  постов фильтровать `post.id`, для которых
  `await moderation.isHidden('post', post.id)`, и комментарии —
  `isHidden('comment', comment.id)`.
- **HTML-страница** (`apps/api/src/profile` / публичная отдача, ТЗ §3.8): при
  скрытии (`ban_html`) отдавать заглушку или `404`, проверяя
  `isHidden('html_page', pageId)`.

Так как соответствующие модули принадлежат параллельным блокам, вызовы
`isHidden` здесь не добавлены — чтобы не менять чужие модули и не ловить циклы
Nest. Подключение: импорт `ModerationModule` (экспортирует `ModerationService`,
циклов нет — он зависит только от `AuthModule` и глобального `PrismaModule`).

## Web

- `apps/web/src/components/report-button.tsx` — `<ReportButton targetType targetId />`
  с диалогом (причина, пояснение до 1000 символов, submit/cancel). Блоки
  профиля/ленты/HTML-страницы подключают её у цели:
  `<ReportButton targetType="profile" targetId={profile.userId} />`.
  На собственном профиле передавать `hidden`, либо не рендерить.
- `apps/web/src/app/(app)/moderation/page.tsx` — очередь жалоб и журнал; роль
  берётся из `/api/auth/me`, без роли показывается «доступ только у модераторов».
- Ссылка «Модерация» в `app-shell.tsx` видна, только если
  `canModerate(user.role)` (`@puls/shared`).
- Строки UI — только в `apps/web/src/lib/i18n.ts` (ключи `report.*`,
  `moderation.*`), ru и en совпадают по набору ключей.

## Тесты

- `apps/api/test/moderation.integration.test.ts`: 403 для обычного пользователя,
  самозащита, дубль, ограничение частоты, скрытие/отклонение, журнал, `isHidden`.
- `apps/web/e2e/moderation.spec.ts`: пользователь отправляет жалобу, модератор
  видит её в очереди и закрывает скрытием (`ban_html`), действие в журнале.

Роль модератора в e2e выставляется прямым `UPDATE users.role` через
`prisma db execute` (отдельного эндпоинта смены ролей в ТЗ нет).
