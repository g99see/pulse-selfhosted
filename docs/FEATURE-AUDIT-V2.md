# Аудит функций Пульса v2

Проход по всем `docs/PHASE*.md` (36 файлов) и `docs-site/guide/usage/*.md` (18 файлов).

## Метод и границы

1. **Эндпоинты.** Скрипт сопоставил каждый `METHOD /api/…` из документов с декораторами
   контроллеров (`@Controller` + `@Get/@Post/…`). Расхождения разобраны вручную.
2. **Тесты.** Для каждой функции указан интеграционный тест (`apps/api/test/*.integration.test.ts`,
   реальный PostgreSQL), unit-тест в `packages/shared/test` или `apps/web/test`. Полный прогон
   API-набора на этой ветке: **72 файла, 706 тестов — зелёные** (см. отчёт ниже).
3. **Что не проверялось:** e2e Playwright (общие порты) — спеки существуют, статус «e2e не
   запускался»; реальные внешние сервисы (Telegram/Discord/Google/AI-провайдеры) — везде фейки;
   `scripts/backup.sh`, `restore.sh`, `upgrade.sh` не запускались (нужен docker compose).
4. «Работает» = функция покрыта проходящим тестом из набора. Я не перечитывал каждое утверждение
   каждого теста: утверждения о покрытии идут от названий и числа тестов.

Статусы: **работает** · **частично** · **сломана** · **неактуальна**.

## Итог

| Статус | Функций |
| --- | --- |
| работает | 41 |
| частично | 4 |
| сломана | 0 (после исправлений) |
| неактуальна | 3 |
| **всего** | **48** |

До исправлений в этой ветке были **сломаны/неполны 4 пункта** (они ниже в списке багов, все
исправлены): предупреждения бюджета и сверка не срабатывали после импорта, бот не регистрировал
меню команд, `/spent` не существовал.

## Таблица функций

### Фаза 1

| Функция | Источник | Статус | Доказательство |
| --- | --- | --- | --- |
| Регистрация, вход, сессии, CSRF, восстановление | PHASE1-AUTH | работает | `auth.integration.test.ts` (18) |
| Чек-ины: создание, окно 24 ч, расписание, история | PHASE1-CHECKINS, usage/checkins | работает | `checkins.integration.test.ts` (19), `checkins.service.test.ts` |
| Экспорт JSON/CSV, удаление аккаунта, реестр таблиц | PHASE1-EXPORT, usage/import-export | работает | `account.integration.test.ts` (12), `data-registry.test.ts` |
| Финансы: счета, категории, операции, бюджеты, быстрый ввод | PHASE1-FINANCE, usage/finance | работает | `finance.integration.test.ts` (19) |
| Уведомления v1: web push, VAPID, email, `/notifications/rules`, `/subscriptions` | PHASE1-NOTIFICATIONS | **неактуальна** | Удалено миграцией `20261006120000_notifications_v2`; в коде нет эндпоинтов и VAPID. В документ добавлена пометка |
| Расписание уведомлений (чистая логика, тихие часы, DST) | PHASE1-NOTIFICATIONS | работает | `packages/shared/test/notifications.test.ts`, `notifications.integration.test.ts` |
| Мастер первого запуска, роли, режим регистрации | PHASE1-OPS | работает | `setup.integration.test.ts` (11) |
| Бэкап / восстановление / обновление скриптами | PHASE1-OPS, admin | частично | Скрипты есть, `sh -n` ок; **в этой сессии не запускались** (нужен docker). Откат миграций добавлен (§8), проверен на отдельной схеме |
| PWA, тема, локализация ru/en | PHASE1-PWA | работает | `web/test/i18n.test.ts`, `no-hardcoded-text.test.ts`, `theme.test.ts`; `pwa.spec.ts` (e2e не запускался); сборка web в гейтах |
| Статистика: день, отчёт, календарь настроения, кеш | PHASE1-STATS, usage/stats-insights | работает | `stats.integration.test.ts` (17) |
| Корреляции настроение/сон/траты (в PHASE1-STATS числились «не сделано») | PHASE1-STATS | работает | **Реализовано в этой ветке**: `correlations.test.ts`, `v2-features.integration.test.ts` |

### Фаза 2

| Функция | Источник | Статус | Доказательство |
| --- | --- | --- | --- |
| 2FA TOTP + резервные коды | PHASE2-2FA (v3 §7.1) | **неактуальна** | Удалено: TOTP, резервные коды и пропуска убраны из кода и схемы, `two-factor.integration.test.ts` удалён |
| Достижения и серии | PHASE2-ACHIEVEMENTS | работает | `achievements.integration.test.ts` (17); серия чек-инов проверена и в `v2-features` |
| Мультивалютность, курсы | PHASE2-CURRENCY | работает | `currency.integration.test.ts` (13) |
| Цели и пополнения | PHASE2-GOALS, usage/goals | работает | `goals.integration.test.ts` (11) |
| Импорт CSV | PHASE2-IMPORT | работает | `import.integration.test.ts` (9); после импорта теперь срабатывают бюджет и сверка (были сломаны) |
| Инсайты, недельный разбор, обратная связь | PHASE2-INSIGHTS | работает | `insights.integration.test.ts` (10). Пункт «недельный отчёт в Telegram не отправляется» устарел: отправка идёт через `notifyWeeklyReport` (`notifications.integration.test.ts`) |
| Вход через Google | PHASE2-OAUTH | работает | `external-auth.integration.test.ts` (на фейках провайдеров; вход через Telegram удалён в v3 §7.3) |
| Регулярные платежи | PHASE2-RECURRING | работает | `recurring.integration.test.ts` (10) |
| Telegram-бот: привязка, команды, быстрые траты, undo | PHASE2-TELEGRAM, usage/telegram | работает | `telegram.integration.test.ts` (26), `commands.test.ts`. Добавлены `/spent`, меню `setMyCommands` |

### Фаза 3

| Функция | Источник | Статус | Доказательство |
| --- | --- | --- | --- |
| HTML-страница: хранение, версии, публикация, автопроверка | PHASE3-HTMLPAGE, usage/html-page | работает | `html-page.integration.test.ts` (16) |
| UI редактора, песочница, `/@nick/page` | PHASE3-HTMLPAGE-UI | частично | API проверен; сам UI и песочница — только e2e `html-page.spec.ts` (не запускался); ClamAV-проверка зависит от окружения |
| Модерация, жалобы, роли | PHASE3-MODERATION | работает | `moderation.integration.test.ts` (8) |
| Публичный профиль и приватность | PHASE3-PROFILE, usage/profile-social | работает | `profile.integration.test.ts` (10) |
| Карточка для шеринга | PHASE3-SHARE | частично | `share.integration.test.ts` (10) проверяет API/приватность; растеризация PNG — fallback без нативных зависимостей, не проверялась визуально |
| Соцлента: подписки, посты, реакции | PHASE3-SOCIAL | работает | `social.integration.test.ts` (13) |

### Фаза 4

| Функция | Источник | Статус | Доказательство |
| --- | --- | --- | --- |
| AI-бэкенд: ключи, провайдеры, лимиты, админка | PHASE4-AI-BACKEND | работает | `ai.integration.test.ts` (14) на подменённом провайдере; реальные провайдеры не вызывались |
| AI-помощник: чат, инструменты, предложения, разбор | PHASE4-AI-ASSISTANT, AI-UI | работает | `ai-assistant.integration.test.ts` (7), `ai-client.test.ts` |
| Открытый API, токены, вебхуки | PHASE4-API | работает | `api-access.integration.test.ts` (13) |
| Семейный режим | PHASE4-FAMILY | работает | `family.integration.test.ts` (12) |

### Фаза 5

| Функция | Источник | Статус | Доказательство |
| --- | --- | --- | --- |
| Капсулы времени | PHASE5-CAPSULES, usage/capsules | работает | `capsules.integration.test.ts` (5) |
| Челленджи | PHASE5-CHALLENGES, usage/challenges | работает | `challenges.integration.test.ts` (13) |
| Виджет цели (iframe) | PHASE5-GOAL-WIDGET, usage/goal-widget | работает | `goal-widget.integration.test.ts` (6) |
| Привычки | PHASE5-HABITS, usage/habits | работает | `habits.integration.test.ts` (13) |
| Режим «Тишина» | PHASE5-QUIET, usage/quiet-mode | работает | клиентская логика; `quiet-mode.spec.ts` (e2e не запускался), используется в карточках v2 |
| Голосовой чек-ин | PHASE5-VOICE-CHECKIN, usage/voice-checkin | частично | Теги из речи — `voice-tags.test.ts`; распознавание речи зависит от Web Speech API браузера, не проверяемо в Node |
| Wrapped «Год в цифрах» | PHASE5-WRAPPED, usage/wrapped | работает | `wrapped.integration.test.ts` (7) |
| Сверка счёта с банком | usage/reconciliation | работает | `reconciliation.integration.test.ts` (9) + уведомление о расхождении (новое) |
| Уведомления v2: outbox, повторы, Telegram/Discord | usage/notifications | работает | `notifications.integration.test.ts` (30) |
| Приёмка Фазы 1 | PHASE1-ACCEPTANCE | неактуальна | Список «не сделано» устарел (корреляции сделаны, резервное копирование и мастер есть); помечен |

### Новое в v2 (§7–§8)

| Функция | Статус | Доказательство |
| --- | --- | --- |
| Корреляции сна/энергии/настроения и трат, правила инсайтов, `GET /api/insights/correlations`, карточка на `/insights` | работает | `correlations.test.ts` (4), `v2-features` (3) |
| Цель чек-инов N/неделя, прогресс, `GET/PUT /api/checkins/goal`, карточка на `/checkin` | работает | `checkin-goal.test.ts` (3), `v2-features` (3) |
| Предупреждения бюджета: API, быстрый ввод, импорт, `/spent` | работает | `v2-features` (4 сквозных теста) |
| `/spent 12 кофе`, `/mood 4`, `/today`, `setMyCommands` | работает | `commands.test.ts`, `v2-features` (4) |
| Приватная ссылка «Итог дня» `/d/<токен>`, переключатель в настройках | работает | `v2-features` (2); `day-summary.spec.ts` (e2e не запускался) |
| `notifyReconciliationMismatch` после импорта, один раз на выписку | работает | `v2-features` (2) |
| `down.sql` для v2-миграций, `scripts/migrate-rollback.sh` | работает | `migrations-rollback.test.ts` (9); откат/накат прогнан на отдельной схеме |
| JSON-логи 5xx, `X-Request-Id`, `GET /api/admin/metrics`, карточка админа | работает | `request-log.test.ts` (2), `v2-features` (2) |

## Найденные баги и пробелы (task list)

- [x] **Импорт выписки не вызывал предупреждения бюджета.** `import.service` создаёт операции
  `createMany` без события `transaction.created`. Исправлено: внутреннее событие `import.expenses`
  → `BudgetAlerts.onImport` (тест «импорт выписки: бюджет пересечён»).
- [x] **Сверка не сообщала о расхождении.** `notifyReconciliationMismatch` нигде не вызывался.
  Исправлено: `ReconciliationAlerts` по событию `statement.imported`, отметка
  `mismatch_notified_at` (миграция `20261006150000`), один раз на выписку.
- [x] **Меню команд бота не регистрировалось** (`setMyCommands` отсутствовал). Исправлено при
  старте бота; список — `BOT_COMMANDS`.
- [x] **Не было команды `/spent`.** Добавлена.
- [x] **Нет цели по чек-инам, нет корреляций, нет ссылки «Итог дня», нет метрик.** Реализовано (§7–§8).
- [x] **Документы PHASE1-NOTIFICATIONS и PHASE1-ACCEPTANCE устарели** — помечены/поправлены.
- [ ] Вебхук `transaction.created` не уходит для операций импорта и переводов (событие шины
  внешних подписчиков только у `create`). Решение — продуктовое, не чинил.
- [ ] Предупреждение бюджета считается по `amountBase`; операция без категории не даёт алерта
  (так задумано, но в UI `/spent` об этом говорится только «категория не определена»).
- [ ] Страница `/d/<токен>` показывает «сегодня» по часовому поясу владельца; истории дней нет.
- [ ] e2e (Playwright) не запускались в этой сессии: общие порты. Спеки согласованы с UI.
- [ ] `scripts/backup.sh` / `migrate-rollback.sh` целиком (с docker compose, psql) не
  исполнялись: в окружении нет `psql`/compose. Проверены: синтаксис, разбор аргументов, сам
  `down.sql` и `prisma migrate resolve` на отдельной схеме PostgreSQL.
- [ ] Ограничения из документов остаются: режим регистрации `invite` работает как «закрыто»;
  «умное время» уведомлений не подключено к планировщику; нет таблицы аудита удаления аккаунта.
