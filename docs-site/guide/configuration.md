# Настройка: все переменные .env

Все настройки «Пульса» задаются переменными окружения в файле `.env` в корне
репозитория (шаблон — `.env.example`). Docker Compose читает этот файл и
пробрасывает значения в контейнеры. Ниже — переменные, которые реально используются
в `docker-compose.yml`, `docker-compose.dev.yml`, `Caddyfile` и `.env.example`,
сгруппированные по назначению.

::: warning
Файл `.env` содержит секреты — **никогда не коммитьте его** в git.
:::

## PostgreSQL

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `POSTGRES_USER` | `puls` | Пользователь базы данных |
| `POSTGRES_PASSWORD` | `change-me-in-production` (в `.env.example`) | Пароль БД — **обязательно смените** |
| `POSTGRES_DB` | `puls` | Имя базы данных |
| `DATABASE_URL` | `postgresql://puls:***@localhost:5432/puls?schema=public` | Строка подключения. Для запуска API на хосте (dev) указывает на `localhost`; в compose API сам собирает строку на сервис `postgres` |

## Valkey / Redis

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6379` (для хоста); в compose — `redis://valkey:6379` | Подключение к Valkey: кеш, ограничение частоты входов, очереди BullMQ (расписание уведомлений). Без него планировщик откатывается на таймер в процессе |

## API

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `NODE_ENV` | `development` (`.env.example`); `production` (в compose) | Режим. В `production` cookie `Secure`, включаются планировщики |
| `API_PORT` | `3001` | Порт API внутри контейнера |
| `CORS_ORIGIN` | `http://localhost:3000`; в compose — из `PUBLIC_ORIGIN` | Разрешённый origin веб-приложения |
| `WEB_APP_URL` | `http://localhost:3000`; в compose — из `PUBLIC_ORIGIN` | Базовый адрес web — используется в ссылках писем и для возврата браузера после OAuth |
| `NOTIFICATIONS_SCHEDULER` | `on` (`1` / `on` включает, `off` / `0` выключает) | Планировщик уведомлений в API |
| `NOTIFICATIONS_TICK_MS` | `60000` | Период тика планировщика уведомлений, мс |
| `INSIGHTS_SCHEDULER` | `on` | Планировщик недельных инсайтов |
| `INSIGHTS_TICK_MS` | `60000` | Период тика планировщика инсайтов, мс |
| `RECURRING_SCHEDULER` | `on` | Планировщик регулярных платежей |
| `RECURRING_TICK_MS` | `60000` | Период тика планировщика регулярных платежей, мс |
| `SESSION_TTL_DAYS` | `30` | Срок жизни сессии, дней |
| `EMAIL_VERIFY_TTL_HOURS` | `24` | Срок жизни токена подтверждения email, часов |
| `ARGON2_MEMORY_COST` | `19456` | Память Argon2id (параметр OWASP) |
| `ARGON2_TIME_COST` | `2` | Число итераций Argon2id |
| `ARGON2_PARALLELISM` | `1` | Степень параллелизма Argon2id |
| `RATE_LIMIT_STORE` | `memory` — только для тестов (иначе Valkey) | Хранилище счётчиков ограничения входов |
| `MAIL_TRANSPORT` | `smtp`, если задан `SMTP_URL`, иначе `console` | Транспорт почты: `console` (письма в лог/outbox) или `smtp` |

## Web

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` (в compose собирается из `PUBLIC_API_URL`) | Адрес API для браузера. `/` или пусто — тот же origin, что и сайт (запросы на `/api/...`). Впекается на этапе сборки образа web |
| `NEXT_PUBLIC_APP_NAME` | `Пульс` | Отображаемое имя приложения |
| `API_INTERNAL_URL` | `http://api:3001` | Адрес API для серверных запросов Next (внутри docker-сети) |

## Caddy и домены

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `DOMAIN` | `localhost` | Основной домен сервиса |
| `ACME_EMAIL` | `admin@example.com` | Контакт для сертификатов Let's Encrypt |
| `CADDY_BIND` | `0.0.0.0` | Адрес публикации Caddy на хосте. Задайте `127.0.0.1`, если 80/443 заняты другим сервисом |
| `HTTP_PORT` | `80` | Внешний порт HTTP |
| `HTTPS_PORT` | `443` | Внешний порт HTTPS (Caddy знает о нём и ведёт редирект корректно) |
| `PUBLIC_ORIGIN` | `http://localhost` | Публичный origin основного сайта; отсюда берутся `CORS_ORIGIN` и `WEB_APP_URL` |
| `PUBLIC_API_URL` | `http://localhost`; установщик пишет `/` | Адрес API для браузера — передаётся web как `NEXT_PUBLIC_API_URL`. `/` — тот же origin, что и сайт: одна установка работает по любому адресу (LAN и Tailscale). Пустое значение compose заменяет на умолчание, поэтому пишите `/` |
| `CADDYFILE` | `Caddyfile` | Какой конфиг Caddy монтировать. `Caddyfile.http` — режим http в локальной сети без домена и сертификатов (сайт на :80) |
| `COOKIE_SECURE` | пусто | `true`/`false` — флаг Secure у cookie. `auto` — решается по каждому запросу: Secure ставится, если запрос пришёл с заголовком `X-Forwarded-Proto: https` (его выставляют только порты Caddy `:8081` для Tailscale; на `:80` Caddy перезаписывает его реальной схемой). Нужен, чтобы вход работал и по `http://IP`, и по `https://….ts.net`. Пусто: определяется по схеме `PUBLIC_ORIGIN` (https → true), иначе по `NODE_ENV=production`. По http Secure-cookie браузер отбрасывает — войти нельзя, поэтому в режиме http нужно `false` |

| `EXTRA_ORIGINS` | пусто | Дополнительные origin-ы сайта через пробел, например `https://puls.tailnet.ts.net`. Добавляются в CORS |
| `TS_HTTP_PORT` | `8081` | Порт Caddy на `127.0.0.1` (копия сайта с `X-Forwarded-Proto: https`) — сюда смотрит `tailscale serve --https=443` |

::: warning Режим http
`Caddyfile.http` не шифрует трафик: пароли и сессии идут открытым текстом. Используйте только
в доверенной локальной сети. Без SMTP письма подтверждения не отправляются — оставьте
регистрацию в режиме «по приглашениям» (или `closed`) и создавайте пользователей через админку.
:::

## Почта (SMTP)

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `SMTP_URL` | пусто | Строка SMTP, например `smtp://user:pass@mail.example.com:587` |
| `MAIL_FROM` | `Пульс <noreply@example.com>` | Адрес отправителя писем |

::: tip
**Без SMTP письма не теряются**: транспорт `console` печатает их в лог/outbox,
что удобно для dev и e2e.
:::

## Уведомления (Telegram и Discord)

Уведомления идут только в мессенджеры — Telegram и Discord. Браузерных push-уведомлений
и ключей VAPID больше нет. Токены ботов задаются **только в `.env`**, в базу они не попадают.

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | пусто | Токен общего бота Pulse (см. ниже, «Внешний вход (Google) и Telegram-бот») |
| `DISCORD_BOT_TOKEN` | пусто | Токен Discord-бота. Без него Discord-канал выключен |
| `DISCORD_APPLICATION_ID` | пусто | Application ID — для OAuth-ссылки привязки и регистрации команды `/link` |
| `DISCORD_CLIENT_SECRET` | пусто | Client secret приложения (OAuth2 → General) — обмен кода привязки |
| `DISCORD_OAUTH_REDIRECT_URI` | пусто | Публичный redirect URI (OAuth2 → Redirects), напр. `https://домен/api/discord/callback`. Без `DISCORD_CLIENT_SECRET` и этого URI кнопка «Подключить Discord» отвечает `503` |
| `DISCORD_API_FAKE` | — | `1` — сеть Discord подменяется заглушкой (тесты, отладка) |
| `NOTIFICATIONS_SCHEDULER` | `on` | `off` — выключить планировщик и воркер отправки |
| `NOTIFICATIONS_TICK_MS` | `60000` | Период проверки расписания, мс |
| `NOTIFICATIONS_WORKER_MS` | `15000` | Период воркера очереди отправки, мс |

Как создать Discord-бота — в разделе [«Уведомления в Discord»](/guide/quick-start#уведомления-в-discord)
быстрого старта. Подробности про очередь, повторы и журнал — в разделе
[Уведомления](/guide/usage/notifications).

## Шифрование секретов

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `APP_ENCRYPTION_KEY` | пусто | Мастер-ключ **AES-256-GCM**: ровно 32 байта в base64. Шифрует AI-ключи, секреты вебхуков открытого API и тела капсул |

::: warning
В `production` без корректного `APP_ENCRYPTION_KEY` недоступны AI-ключи и
капсулы. Получите значение, например:
`openssl rand -base64 32`.
:::

## Внешний вход (Google) и Telegram-бот

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | пусто | Client ID из Google Cloud Console. Включатель Google — обе переменные пары |
| `GOOGLE_CLIENT_SECRET` | пусто | Client secret Google |
| `GOOGLE_REDIRECT_URI` | пусто (собирается из запроса: `<scheme>://<host>/api/auth/google/callback`) | Фиксированный redirect URI |
| `GOOGLE_AUTH_ENDPOINT` | `https://accounts.google.com/o/oauth2/v2/auth` | Подмена endpoint согласия (тесты / self-hosted прокси) |
| `GOOGLE_TOKEN_ENDPOINT` | `https://oauth2.googleapis.com/token` | Подмена token endpoint |
| `GOOGLE_JWKS_URL` | `https://www.googleapis.com/oauth2/v3/certs` | Подмена набора JWKS |
| `TELEGRAM_BOT_TOKEN` | пусто | Токен бота от @BotFather. Без него бот выключен |
| `TELEGRAM_BOT_USERNAME` | пусто | Имя бота (без `@`) для ссылки на бота |
| `TELEGRAM_MODE` | `webhook` в самом API; `polling` в docker compose | Режим бота. `polling` — сервер сам опрашивает Telegram, публичный адрес не нужен (подходит для домашнего сервера). `webhook` — нужен публичный HTTPS-адрес и вручную зарегистрированный вебхук на `/api/telegram/webhook` |
| `TELEGRAM_WEBHOOK_SECRET` | пусто | Сверяется с заголовком `X-Telegram-Bot-Api-Secret-Token`; без него вебхук отвечает `503` |
| `OAUTH_STATE_TTL_SECONDS` | `600` | Время жизни `state`/PKCE, секунд |

Google включён, только когда заданы **обе** переменные пары `GOOGLE_*` (пустая
строка — «не задано»). Иначе кнопка скрыта, а эндпоинт отвечает
`404 provider_disabled`. Переменные `TELEGRAM_*` относятся к боту-каналу
уведомлений, а не к способу входа.

## Курсы валют

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `RATES_PROVIDER` | пусто | `frankfurter` включает подтягивание курсов с публичного API (данные ЕЦБ). Пусто — работают только ручные курсы |
| `RATES_API_URL` | `https://api.frankfurter.dev/v1` | Своё ECB-совместимое зеркало |

## Бэкапы

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `BACKUP_INTERVAL_HOURS` | `24` | Интервал между бэкапами сервиса `backup`, часов |
| `BACKUP_KEEP` | `7` | Сколько последних архивов хранить (ротация) |
| `BACKUP_DIR` | `./backups` на хосте; `/backups` внутри контейнера | Каталог архивов |
| `PGHOST` | `postgres` (в compose) | Хост PostgreSQL для бэкапа |
| `PGPORT` | `5432` | Порт PostgreSQL |
| `PGUSER` | значение `POSTGRES_USER` (`puls`) | Пользователь для `pg_dump` |
| `PGPASSWORD` | значение `POSTGRES_PASSWORD` | Пароль для `pg_dump` |
| `PGDATABASE` | значение `POSTGRES_DB` (`puls`) | База для дампа |

Ручной бэкап и восстановление описаны в разделе
[Установка за 15 минут](/guide/installation#проверка-бэкап-сервиса).

## Прочее

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `APP_VERSION` | `0.3.0` | Версия приложения; попадает в метаданные архива бэкапа |

## AI-ключи — в базе данных, а не в .env

::: warning
API-ключи AI-помощника (Фаза 4) **не задаются в `.env`**. Общий ключ экземпляра
хранится в таблице настроек инстанса, личный ключ пользователя — в БД, оба
зашифрованы мастер-ключом `APP_ENCRYPTION_KEY` (AES-256-GCM) и никогда не
отдаются в браузер. В `.env.example` закомментированные строки `AI_PROVIDER`,
`AI_API_KEY`, `AI_MASTER_KEY` — черновик, не рабочие переменные.
:::

Подробности подключения — на странице [AI-помощник](/ai/).

## См. также

- [Установка за 15 минут](/guide/installation) — пошаговый запуск и обновление.
- [Уведомления](/guide/usage/notifications) — расписание, тихие часы, Telegram и Discord.
- [Telegram-бот](/guide/usage/telegram) — привязка чата и переменные бота.
- [Безопасность](/security/) — сессии, CSRF, шифрование.
- [Администрирование](/admin/) — режим регистрации, бэкап, обновление.
