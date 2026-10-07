# ТЗ-2 §3 и §5: удаление соцсети и PWA — инвентарь

Ветка `v3/social`. Решения: приватная ссылка «Итог дня» (`/d/[token]`, `DaySummaryLink`) **остаётся** — это личная ссылка владельца. Капсулы времени, «Год в цифрах», цели, привычки, инсайты — личные, остаются (из них убраны шаринг и публикация).

## Что удалено

### Экраны web
| Маршрут | Что было |
| --- | --- |
| `/feed` | лента постов, реакции, комментарии |
| `/u/[nickname]`, `/@nickname` (rewrite) | публичный профиль, подписки |
| `/u/[nickname]/page`, `/@nickname/page` | HTML-страница профиля |
| `/page-editor` | редактор HTML-страницы |
| `/moderation` | очередь жалоб модерации |
| `/family` | семья: общие счета, цели, взносы |
| `/challenges` | челленджи, участники, рейтинг |
| `/widget/goal/[goalId]` | публичный виджет цели |
| `/offline`, `/manifest.webmanifest`, `/sw.js` | PWA |
| блок «Профиль» (`ProfileEditor`) и ссылка «HTML-страница» в `/app/profile`; кнопка «Установить» | настройки |
| шаг «Приватность профиля» онбординга; «Кто видит» у цели; встраивание цели (iframe); кнопки шаринга (цели, достижения, стрик, «Год в цифрах») | формы |

Компоненты: `follow-button`, `post-card`, `profile-editor`, `public-html-page`, `report-button`, `share-button`, `install-prompt`. Клиенты `lib/*`: `social`, `profile`, `moderation`, `html-page`, `share`, `family`, `challenges`, `sandbox-origin`, `use-sandbox-page-url`. Меню app-shell: группа «Сообщество» (лента, челленджи, семья), «Страница», «Модерация».

### API (NestJS)
Модули целиком: `social`, `profile` (в т.ч. `public-profiles.controller`, `subscriptions`), `share`, `family`, `challenges`, `moderation`, `html-page` (в т.ч. `sandbox.controller`, `clamav`), контроллер и сервис публичного виджета цели в `widgets`.
Маршруты: `/api/follows/*` (подписки), `/api/feed`, `/api/posts/:id/reactions|comments`, `/api/comments/:id`, `/api/profile`, `/api/public/profiles/:nickname`, `/api/reports`, `/api/moderation/{reports,actions}`, `/api/html-page*` (версии, загрузка, откат), `/sandbox/:nickname` (вне префикса), `/api/share/card[.png]`, `/api/family*` (семья, приглашения, счета, цели), `/api/challenges*` (участие, рейтинг, приглашения), `/api/public/widgets/goal/:id`.
Оставлен `widgets` (только «Итог дня»). `RolesGuard`/`@Roles` перенесены из `moderation/` в `auth/` — используются админкой AI и метриками.
Фоновые задачи: отдельных планировщиков у соцсети не было. Уведомление `reactions` (реакции/комментарии под постом) удалено: тип убран из `NOTIFICATION_TYPES`, `buildPostActivityNotification`, `notifyPostActivity`.
Связки: посты о целях/вехах/достижениях (`SocialPostsService` в `GoalsService` и `AchievementsService`) убраны; публикация цели (`Goal.visibility`), `User.profileVisibility` удалены; AI-инструмент создания цели больше не принимает `visibility`.

### Таблицы БД (миграция `20261007100000_remove_social`)
`follows`, `posts`, `reactions`, `comments`, `profiles`, `profile_cards`, `reports`, `moderation_actions`, `content_flags`, `html_pages`, `html_page_versions`, `families`, `family_members`, `family_invites`, `family_accounts`, `family_transactions`, `family_goals`, `family_goal_deposits`, `challenges`, `challenge_participants`, `challenge_checks`; типы `report_target_type`, `report_reason`, `report_status`, `moderation_action_kind`.
Колонки: `users.profile_visibility`, `goals.visibility`. Правила `notification_rules` с `type = 'reactions'` удаляются. `users.nickname` и роли сохранены. Откат — `down.sql` рядом (пересоздаёт пустые таблицы; данные — только из бэкапа).

### Достижения
Коды `ACHIEVEMENT_CODES` не содержали соц-кодов (чек-ины, транзакции, бюджет, цели), поэтому каталог не менялся; убрана только публикация поста о достижении. Интерфейс `AchievementsService` (`award`, `evaluate`, `list`, `streak`) не тронут.

### shared
Удалены `social`, `profile`, `moderation`, `html-page`, `html-templates`, `share-card`, `family`, `challenges` (и тесты); из `auth` — `ProfileVisibility`; из `goals` — `GoalVisibility`.

### i18n
Удалены ключи `feed.*`, `follow.*`, `profile.*`, `moderation.*`, `report.*`, `share.*`, `htmlPage.*`, `family.*`, `challenges.*`, `widget.*`, `offline.*`, `settings.install*`, `goals.embed.*`, `goals.form.visibility`, `auth.onboarding.visibility*`, `wrapped.share.*`, пункты меню `app.nav.{feed,challenges,family,page,moderation,group.community}`, `notifications.type.reactions` — в ru и en (паритет проверяет `test/i18n.test.ts`).

### Инфраструктура и документация
Caddy: домен/порты песочницы (`SANDBOX_DOMAIN`, `:8080`, `:8082`); compose и `.env.example`: `SANDBOX_*`, `CLAMAV_HOST`, `EXTRA_SANDBOX_ORIGINS`, `TS_SANDBOX_PORT`; `install.sh` (`--sandbox-domain`, `--sandbox-port`), `dev-run.sh`; Dockerfile web. Страницы docs-site: семья, челленджи, виджет цели, профиль и лента, HTML-страница; упоминания в README, quick-start, installation, configuration, admin, security, architecture, roadmap.
e2e-спеки: `social`, `profile`, `share`, `moderation`, `html-page`, `family`, `challenges`, `goal-widget`, `pwa`.
Интеграционные тесты API: `social`, `profile`, `share`, `moderation`, `html-page`, `family`, `challenges`, `goal-widget`.

## PWA (§5)
Удалены `app/manifest.ts`, `src/sw.ts` (Serwist), `/offline`, `InstallPrompt`, зависимости `@serwist/next` и `serwist`, правила `public/sw.js` в `.gitignore`, ссылка на манифест и apple-web-app метатеги в `layout.tsx`. Иконки и favicon оставлены. `serviceWorkers: 'block'` в playwright оставлен (безвреден).

## Проверка полноты (завершающий проход)
Повторный греп по API/web/shared/prisma/docs/ботам Telegram и Discord не нашёл активных сущностей соцсети, соцпрофилей, шаринга, лент, PWA (манифест, service worker, кнопка установки). Найденное и исправленное:

- `packages/shared/src/goals.ts`: удалены неиспользуемые DTO публичного виджета цели `GoalWidgetDto` / `GoalWidgetResponse` (остаток виджета цели).
- `apps/web/package.json`: из описания убрано «и PWA».
- `docs-site/admin/index.md`: убрана ссылка на `docs/PHASE3-MODERATION.md` (модерация удалена).

Осознанно **оставлены** внутренние проектные документы `docs/PHASE*.md`, `docs/PLAN.md` и `docs/FEATURE-AUDIT-V2.md` — это архив/снимки по фазам (в них описаны и другие удаляемые блоки, напр. 2FA и Google-вход, которые относятся к своим подпунктам ТЗ-2). Пользовательская документация (`docs-site`, README, CHANGELOG, SECURITY) уже очищена.

Миграция `20261007100000_remove_social` затрагивает только соцсущности и соцполя; таблицы чек-инов, финансов, достижений, привычек, капсул и инсайтов не трогаются. `data-registry.ts` актуален: удалённых соцтаблиц в нём нет, интеграционный тест покрытия зелёный. Достижений, зависящих от соцфункций (типа «пригласи друга»), в каталоге `ACHIEVEMENTS` не было и нет.

Гейты на завершающем проходе: `pnpm --filter @puls/shared build && pnpm -r typecheck && pnpm lint && pnpm format:check` — зелёные; `@puls/shared` 381 тест, `@puls/web` 109, `@puls/api` 62 файла / 608 тестов — зелёные.
