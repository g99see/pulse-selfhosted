# Фаза 2. Боты Telegram и Discord (ТЗ §6, §4, P1)

Боты работают через **один общий бот Pulse на сервис** — пользователю не нужно
создавать собственного бота через @BotFather или Discord Developer Portal.
Привязка выполняется двумя действиями: кнопка «Подключить» в настройках и
подтверждение у бота. Без `TELEGRAM_BOT_TOKEN` / `DISCORD_BOT_TOKEN` модуль
неактивен: в логах предупреждение, API работает как обычно.

Бот Telegram на [grammY](https://grammy.dev) (лицензия MIT) — чек-ины и траты
прямо из чата, без открытия сайта. Бот Discord — на встроенном WebSocket Node и
Discord REST v10 без зависимостей.

## Переменные окружения

| Переменная | Назначение | Значение по умолчанию |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Токен общего бота Pulse. Без него бот выключен | — (пусто) |
| `TELEGRAM_BOT_USERNAME` | Имя общего бота для deep-link `https://t.me/<bot>`. Если не задано, берётся из `getMe` | — (пусто) |
| `TELEGRAM_WEBHOOK_SECRET` | Секрет вебхука, сверяется с `X-Telegram-Bot-Api-Secret-Token` | — (пусто, вебхук отвечает 503) |
| `TELEGRAM_MODE` | `webhook` (прод) или `polling` (разработка) | `webhook` |
| `TELEGRAM_API_FAKE` | `1` — клиент Telegram подменяется заглушкой (e2e, отладка): реальных запросов нет | — |
| `DISCORD_BOT_TOKEN` | Токен общего Discord-бота | — (пусто) |
| `DISCORD_APPLICATION_ID` | Application (client) ID для OAuth-ссылки | — (пусто) |
| `DISCORD_CLIENT_SECRET` | Секрет приложения для обмена OAuth-кода | — (пусто) |
| `DISCORD_OAUTH_REDIRECT_URI` | Публичный redirect URI, добавленный в Discord → OAuth2 → Redirects | — (пусто) |
| `DISCORD_API_FAKE` | `1` — клиент Discord подменяется фейком (тесты, отладка) | — |

Владелец регистрирует вебхук Telegram у себя (setWebhook с секретом) или
пользуется режимом polling. Переменные добавлены в `.env.example` и
`docker-compose.yml`.

## Привязка одним нажатием (ТЗ §6)

Пользователь в настройках нажимает «Подключить Telegram» (или «Подключить
Discord») — собственному боту BotFather/Developer Portal не нужен.

1. `POST /api/telegram/connect` (или `/api/discord/connect`) создаёт одноразовый
   **токен привязки**: TTL 10 минут, в БД хранится только SHA-256 от токена
   (`telegram_link_codes.code_hash` / `discord_link_codes.code_hash`), не более
   5 запросов за 10 минут на пользователя.
2. Ответ — `BotConnectLinkResponse { url, expiresAt, ttlSeconds }`:
   - Telegram: deep-link `https://t.me/<bot>?start=<токен>` (имя бота из
     `TELEGRAM_BOT_USERNAME` или `getMe`).
   - Discord: OAuth-ссылка `https://discord.com/oauth2/authorize?...&state=<токен>`.
3. Пользователь открывает ссылку и подтверждает:
   - Telegram: жмёт Start — бот получает `/start <токен>`.
   - Discord: подтверждает доступ, Discord возвращает его на
     `GET /api/discord/callback?code=…&state=…`.
4. Бот/сервис проверяет токен, привязывает `chat_id` (Telegram) или
   `user_id` + DM-канал (Discord) к аккаунту, **гасит токен** (`used_at`) и
   присылает подтверждение.
5. Экран настроек **обновляется сам**: клиент опрашивает
   `GET /api/notifications/channels` каждые 3 секунды, пока канал не станет
   `linked`. Enter кодов вручную больше не нужен.

Отключение и повторное подключение — одной кнопкой `DELETE /api/{telegram,discord}/link`.

Один чат/аккаунт — один пользователь Pulse, у пользователя — одна привязка.

### Обработка ошибок

| Ситуация | Поведение |
| --- | --- |
| Токен просрочен (TTL 10 мин) | Бот отвечает «Ссылка привязки истекла…», привязки нет |
| Токен уже использован | Бот отвечает «Эта ссылка уже использована…», привязка не создаётся |
| Цель занята другим аккаунтом | «Этот чат/Discord уже привязан к другому аккаунту» |
| Бот заблокирован пользователем | Привязка помечается `blocked_at` (доставка остановлена); любая новая активность в чате снимает блокировку, канал снова активен |

## Команды Telegram

| Команда | Действие |
| --- | --- |
| `/start <токен>` | Привязка чата по ссылке из настроек |
| `/checkin` | Вопрос «Как ты себя чувствуешь?» с inline-кнопками 1–5 |
| `кофе 250`, `зарплата +80000` | Быстрая транзакция на счёт по умолчанию; ответ «Записал! …» + кнопка «Отменить» |
| `/spent 12 кофе` | Трата с бюджетом категории |
| `/mood 4`, `/today`, `/help`, `/unlink` | Настроение, итоги дня, справка, отвязка |

Callback-данные: `mood:1..5` — создать чек-ин через `CheckinsService.create`;
`undo:<transactionId>` — удалить транзакцию через `TransactionsService.remove`.

Discord принимает slash-команду `/link` (и DM `/start <токен>`) как запасной
путь; основной сценарий — OAuth-кнопка.

## HTTP-точки

| Метод и путь | Защита | Назначение |
| --- | --- | --- |
| `POST /api/telegram/webhook` | заголовок `X-Telegram-Bot-Api-Secret-Token` | Приём апдейтов Telegram |
| `GET /api/telegram/status` | SessionGuard | Состояние привязки для настроек |
| `POST /api/telegram/connect` | SessionGuard + CSRF + rate limit | Одноразовая ссылка-подключение |
| `DELETE /api/telegram/link` | SessionGuard + CSRF | Отвязка |
| `GET /api/discord/status` | SessionGuard | Состояние привязки Discord |
| `POST /api/discord/connect` | SessionGuard + CSRF + rate limit | OAuth-ссылка-подключение |
| `GET /api/discord/callback` | одноразовый `state`-токен (GET, CSRF не применяется) | Завершение OAuth-привязки |
| `DELETE /api/discord/link` | SessionGuard + CSRF | Отвязка |

## Уведомления

В `NOTIFICATION_CHANNELS` есть каналы `telegram` и `discord`. Диспетчер
отправляет сообщение в привязанный чат/DM, а для типа `checkins` прикладывает
inline-кнопки 1–5. Если канал не привязан — доставка возвращает `false`.

## Изоляция внешних API

Реальные запросы делает `GrammyTelegramApi` (Telegram) и `RestDiscordApi`
(Discord); ядро работает через интерфейсы `TelegramApi` / `DiscordApi`
(DI-токены `TELEGRAM_API`, `DISCORD_API`). В тестах провайдеры подменяются
фейками — **ни один тест не ходит в сеть**. Чистая логика (разбор команд и
callback-ов, нормализация `Update`, токены привязки и ссылки, тексты) вынесена
в отдельные модули и покрыта unit-тестами.

## Данные

- Реестр экспорта (`apps/api/src/account/data-registry.ts`):
  `telegram_links`, `discord_links` выгружаются; `telegram_link_codes`,
  `discord_link_codes` исключены как секреты (там только хеши токенов).
- Схема не менялась: одноразовые токены хранятся в уже существовавших таблицах
  `telegram_link_codes` / `discord_link_codes`.

## Файлы

```
apps/api/src/telegram/
  commands.ts / commands.test.ts      разбор команд и callback-ов, клавиатуры
  updates.ts / updates.test.ts        нормализация Update
  link-token.ts / link-token.test.ts  токены привязки, deep-link и OAuth-ссылки
  messages.ts                         тексты ответов бота
  telegram-api.ts                     интерфейс TelegramApi + grammY + заглушка
  telegram.service.ts                 привязка одним нажатием, команды, изоляция
  telegram-poller.ts                  long polling для разработки
  telegram.controller.ts              вебхук и подключение из настроек
  telegram.module.ts
apps/api/src/discord/
  discord-api.ts                      интерфейс DiscordApi + REST + фейк + OAuth
  discord-events.ts                   разбор событий Gateway (/start, /link)
  discord.service.ts                  OAuth-подключение, привязка, доставка
  discord.controller.ts               connect / callback / status / unlink
  discord-gateway.ts                  Discord Gateway (личные сообщения)
apps/api/test/telegram.integration.test.ts     интеграционные тесты бота
apps/api/test/notifications.integration.test.ts  каналы и OAuth-привязка Discord
apps/web/src/components/notification-settings.tsx  кнопка «Подключить» + опрос
apps/web/src/lib/telegram-client.ts
packages/shared/src/telegram.ts        общие типы ответов (BotConnectLinkResponse)
```

## Как проверить

```bash
pnpm --filter @puls/shared build
pnpm --filter @puls/api test        # unit + интеграционные (нужен PostgreSQL)
pnpm --filter @puls/web test
pnpm lint && pnpm typecheck
pnpm e2e                            # e2e поднимает API с TELEGRAM_BOT_TOKEN + TELEGRAM_API_FAKE=1
pnpm license:check                  # grammY — MIT
```
