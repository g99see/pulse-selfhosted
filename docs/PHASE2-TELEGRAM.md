# Фаза 2. Telegram-бот (ТЗ §3.6, §4, P1)

Бот на [grammY](https://grammy.dev) (лицензия MIT) — чек-ины и траты прямо из
чата, без открытия сайта. Без `TELEGRAM_BOT_TOKEN` модуль неактивен: в логах
появляется предупреждение, API работает как обычно.

## Переменные окружения

| Переменная | Назначение | Значение по умолчанию |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather. Без него бот выключен | — (пусто) |
| `TELEGRAM_WEBHOOK_SECRET` | Секрет вебхука, сверяется с `X-Telegram-Bot-Api-Secret-Token` | — (пусто, вебхук отвечает 503) |
| `TELEGRAM_MODE` | `webhook` (прод) или `polling` (разработка) | `webhook` |
| `TELEGRAM_API_FAKE` | `1` — клиент Telegram подменяется заглушкой (e2e, отладка): реальных запросов нет | — |

Владелец регистрирует вебхук у Telegram:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<домен>/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Новые переменные в `.env.example`, `docker-compose*` и `Caddyfile` **не
добавлялись** (их правят отдельные задачи Фазы 2) — здесь только описание.

## Режимы

- **webhook** — Telegram шлёт апдейты на `POST /api/telegram/webhook`. Запрос
  не несёт cookie сессии, поэтому путь исключён из глобального `CsrfGuard` и
  защищён только секретным заголовком (сравнение за постоянное время).
- **polling** — `TelegramPoller` в процессе API вызывает `getUpdates` и
  обрабатывает апдейты. В тестах (`NODE_ENV=test`) не стартует; при
  недоступности Telegram цикл ждёт и повторяет, API не падает.

## Привязка чата

1. В настройках сайта (`/settings`) секция «Telegram» → «Привязать Telegram».
2. `POST /api/telegram/link-code` отдаёт одноразовый код (16 символов,
   TTL 10 минут, не более 5 запросов за 10 минут на пользователя). В БД
   хранится только SHA-256 от кода (`telegram_link_codes.code_hash`).
3. Пользователь шлёт боту `/start <код>`.
4. Создаётся `TelegramLink(user_id, chat_id unique, username, linked_at)`,
   код помечается использованным, включается правило уведомлений
   `checkins / telegram`.
5. Отвязка — кнопка «Отвязать» (`DELETE /api/telegram/link`) или `/unlink`.

Один чат — один аккаунт, у пользователя — один чат. Чужой `chat_id` без
привязки получает только подсказку про привязку и ничего не пишет в БД.

## Команды

| Команда | Действие |
| --- | --- |
| `/start <код>` | Привязка чата |
| `/checkin` | Вопрос «Как ты себя чувствуешь?» с inline-кнопками 1–5 |
| `кофе 250`, `зарплата +80000` | Быстрая транзакция на счёт по умолчанию; категория подбирается `guessCategoryName`; ответ «Записал! …» + кнопка «Отменить» |
| `/today` | Траты и среднее настроение за сегодня (`StatsService.day`) |
| `/unlink` | Отвязать чат |
| `/help` | Справка |

Callback-данные: `mood:1..5` — создать чек-ин через `CheckinsService.create`;
`undo:<transactionId>` — удалить транзакцию через `TransactionsService.remove`.

## HTTP-точки

| Метод и путь | Защита | Назначение |
| --- | --- | --- |
| `POST /api/telegram/webhook` | заголовок `X-Telegram-Bot-Api-Secret-Token` | Приём апдейтов |
| `GET /api/telegram/status` | SessionGuard | Состояние привязки для настроек |
| `POST /api/telegram/link-code` | SessionGuard + CSRF + rate limit | Одноразовый код |
| `DELETE /api/telegram/link` | SessionGuard + CSRF | Отвязка |

## Уведомления

В `NOTIFICATION_CHANNELS` добавлен канал `telegram`. Диспетчер уведомлений
минимально расширен: `delivery.channel === 'telegram'` отправляет сообщение в
привязанный чат, а для типа `checkins` прикладывает inline-кнопки 1–5. Если чат
не привязан — доставка возвращает `false`.

## Изоляция Telegram API

Реальные запросы делает `GrammyTelegramApi`; ядро бота работает через интерфейс
`TelegramApi` (DI-токен `TELEGRAM_API`). В тестах провайдер подменяется фейком —
**ни один тест не ходит в Telegram**. Чистая логика (разбор команд и
callback-ов, нормализация `Update`, коды привязки, тексты) вынесена в отдельные
модули и покрыта unit-тестами.

## Данные

- Реестр экспорта (`apps/api/src/account/data-registry.ts`):
  `telegram_links` выгружается; `telegram_link_codes` исключён как секрет.
- Миграция: `prisma/migrations/20261001140356_telegram_links`.

## Файлы

```
apps/api/src/telegram/
  commands.ts / commands.test.ts      разбор команд и callback-ов, клавиатуры
  updates.ts / updates.test.ts        нормализация Update
  link-code.ts / link-code.test.ts    генерация и хеш одноразовых кодов
  messages.ts                         тексты ответов бота
  telegram-api.ts                     интерфейс TelegramApi + grammY + заглушка
  telegram.service.ts                 привязка, команды, изоляция
  telegram-poller.ts                  long polling для разработки
  telegram.controller.ts              вебхук и привязка из настроек
  telegram.module.ts
apps/api/test/telegram.integration.test.ts  21 интеграционный тест
apps/web/src/components/telegram-section.tsx
apps/web/src/lib/telegram-client.ts
apps/web/e2e/telegram.spec.ts
packages/shared/src/telegram.ts        общие типы ответов
```

## Как проверить

```bash
pnpm --filter @puls/shared build
pnpm --filter @puls/api test        # unit + интеграционные (нужен PostgreSQL)
pnpm lint && pnpm typecheck
pnpm e2e                            # e2e поднимает API с TELEGRAM_BOT_TOKEN
pnpm license:check                  # grammY — MIT
```
