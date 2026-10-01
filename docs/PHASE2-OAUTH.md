# Фаза 2. Вход через Google и Telegram (ТЗ §3.1, §7)

Документ описывает внешние способы входа: Google (OAuth2/OIDC, authorization code
+ PKCE) и Telegram Login Widget (подпись HMAC-SHA256). Оба включаются ключами
владельца инстанса; без ключей провайдер выключен, кнопки в интерфейсе скрыты, а
эндпоинты отвечают `404 provider_disabled`.

## Переменные окружения

Новые переменные описываются здесь (`.env.example` намеренно не меняется —
конфликтов между параллельными задачами избегаем).

| Переменная | Обяз. | Назначение |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | для Google | client id из Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | для Google | client secret |
| `GOOGLE_REDIRECT_URI` | нет | фиксированный redirect URI; если не задан, собирается из запроса (`<scheme>://<host>/api/auth/google/callback`) |
| `GOOGLE_AUTH_ENDPOINT` | нет | подмена endpoint согласия (тесты/self-hosted прокси) |
| `GOOGLE_TOKEN_ENDPOINT` | нет | подмена token endpoint |
| `GOOGLE_JWKS_URL` | нет | подмена набора JWKS |
| `TELEGRAM_BOT_TOKEN` | для Telegram | токен бота вида `123:ABC` |
| `TELEGRAM_BOT_USERNAME` | для Telegram | имя бота для виджета (без `@`) |
| `OAUTH_STATE_TTL_SECONDS` | нет | TTL `state`/PKCE, по умолчанию 600 с |
| `WEB_APP_URL` | нет | куда возвращать браузер после callback (по умолчанию `http://localhost:3000`) |

Включатель — наличие обеих переменных пары. Непустые значения обязательны: пустая
строка считается «не задано».

## Эндпоинты

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/api/auth/providers` | публичный | список включённых провайдеров: `{ google, telegram, telegramBotUsername }` |
| GET | `/api/auth/google/start` | публичный | 302 на Google (authorization code + PKCE + state) |
| GET | `/api/auth/google/callback` | публичный | обмен кода, проверка `id_token`, вход или привязка, редирект в web |
| POST | `/api/auth/telegram` | публичный (CSRF) | вход по данным Telegram Login Widget |
| GET | `/api/auth/identities` | SessionGuard | привязанные способы входа текущего пользователя |
| GET | `/api/auth/link/google/start` | SessionGuard | начать привязку Google (intent = link) |
| POST | `/api/auth/link/telegram` | SessionGuard | привязать Telegram |
| DELETE | `/api/auth/identities/:provider` | SessionGuard | отвязать способ входа |

## Google: поток и защита

1. `google/start` генерирует `state` (32 случайных байта) и `code_verifier`
   (PKCE S256). `state → { code_verifier, intent, user_id }` кладётся на сервере
   с TTL (Valkey, если задан `REDIS_URL` и `NODE_ENV !== 'test'`, иначе — память
   процесса) и дублируется в **httpOnly-cookie** `puls_oauth_state`.
2. Браузер уходит на Google. `callback` требует, чтобы `state` из query совпал с
   cookie (сравнение по времени), после чего `state` **удаляется** из хранилища —
   повторный callback с тем же state отклоняется (`/login?error=oauth_state`).
3. Код меняется на `id_token` (`POST` на token endpoint с `code_verifier`).
   Тяжёлых SDK нет — только `fetch`.
4. `id_token` проверяется по JWKS Google через `node:crypto`
   (`apps/api/src/auth/external/google.tokens.ts`): подпись RS256 по `kid`,
   `exp`, `iat` (с запасом 5 минут), `iss` (`accounts.google.com` /
   `https://accounts.google.com`), `aud` = `GOOGLE_CLIENT_ID`.
   JWKS кешируется по `Cache-Control: max-age`.
5. Вход/привязка и редирект: успех — `WEB_APP_URL/app` либо `/onboarding`,
   ошибки — `/login?error=<oauth_cancelled|oauth_state|oauth_exchange|oauth_token>`,
   привязка — `/settings?linked=google` или `/settings?error=link_failed`.

## Telegram: поток и защита

Telegram Login Widget отдаёт `{ id, first_name, last_name, username, photo_url,
auth_date, hash }`. Проверка (`apps/api/src/auth/external/telegram.ts`):

* секрет = `SHA-256(bot_token)`, подпись = `HMAC-SHA256(check_string, секрет)`,
  где `check_string` — все поля кроме `hash`, отсортированные по имени,
  `ключ=значение`, соединённые `\n`;
* сравнение — `timingSafeEqual`; hash строго `[a-f0-9]{64}`;
* `auth_date` не старше 24 часов и не из будущего (запас 60 с).

Схема тела — «свободная» (`z.looseObject`), чтобы новые поля Telegram не ломали
подпись. Ошибки → `401 invalid_telegram_auth`.

## Создание пользователя и привязка

* **Вход по существующей привязке** `(provider, subject)` — находим пользователя,
  сессия выдаётся сразу.
* **Google + подтверждённый email** (`email_verified === true`), совпавший с
  существующим пользователем, — привязка к нему; email помечается подтверждённым.
  При `email_verified !== true` привязки нет.
* **Иначе — новый пользователь**: `passwordHash = null`, никнейм генерируется и
  проверяется на уникальность (`puls-<6 base36>`, без эмодзи и пробелов).
  Для Google ставится `emailVerifiedAt`, если email подтверждён; без email —
  технический адрес `g-<sub>@google.invalid`.
* **Telegram без email** — технический адрес `tg-<id>@telegram.invalid`.
  `GET /api/auth/me` возвращает `needsEmail: true`, и в настройках показывается
  мягкая подсказка указать настоящий email.
* **Отвязка** запрещена, если у пользователя нет пароля и это единственная
  привязка → `409 last_login_method`.

Вход по паролю для таких аккаунтов даёт `401 invalid_credentials`
(`passwordHash = null`) — прежнее поведение сохранено.

## Модель данных и выгрузка

```prisma
model ExternalIdentity {
  id       String  @id @default(cuid())
  userId   String  @map("user_id")
  provider String
  subject  String
  email    String?
  @@unique([provider, subject])
  @@index([userId])
  @@map("external_identities")
}
```

Миграция — `apps/api/prisma/migrations/20261001134701_external_identities`.
Таблица внесена в реестр выгрузки (`EXPORT_TABLES`, сущность `externalIdentities`):
`subject` не секрет. Удаление аккаунта и так чистит все таблицы с `user_id`.

## Интерфейс

* `components/provider-buttons.tsx` — кнопки на `/login` и `/register`; блок не
  рендерится, если ни один провайдер не включён.
* `components/telegram-login-button.tsx` — вставка скрипта Telegram-виджета.
* `components/linked-accounts-section.tsx` — секция «Способы входа» в `/settings`
  (подключена одной строкой).
* Тексты — только в `lib/i18n.ts` (ru + en, ключи совпадают).

## Тесты

* Юнит: `providers.test.ts`, `telegram.test.ts` (подделка/просрочка/будущее),
  `google.tokens.test.ts` (подпись RS256/exp/iss/aud/kid/alg локальными ключами),
  `nickname.test.ts` (коллизии), `oauth-state.service.test.ts` (PKCE, TTL, replay),
  `google.gateway.test.ts` (PKCE S256 в URL).
* Интеграционные: `test/external-auth.integration.test.ts` — шлюз Google подменён
  фейком (реальных запросов к Google нет), проверяются 404 без ключей, вход,
  привязка по подтверждённому email, replay state, подделка/просрочка Telegram,
  уникальность никнеймов, отвязка единственного способа, изоляция по пользователю.
* E2E: `apps/web/e2e/external-auth.spec.ts` — при выключенных провайдерах кнопок
  нет, `/api/auth/google/start` → 404, вход по паролю работает, раздел привязок
  показывает пароль.

## Ограничения

* Хранилище `state` — Valkey при наличии `REDIS_URL`, иначе память процесса
  (в тестах — всегда память). Для нескольких инстансов API без Valkey state не
  разделяется.
* Смена/добавление собственно email у Telegram-аккаунта реализована только
  подсказкой (`needsEmail`); отдельный эндпоинт смены email — вне рамок задачи.
* Реальные запросы к Google/Telegram в автотестах не выполняются.
