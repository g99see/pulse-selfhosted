# Фаза 2. Вход через Google (Telegram-вход удалён в v3 §7.3)

Документ описывает внешний способ входа — Google (OAuth2/OIDC, authorization code
+ PKCE). Вход через Telegram Login Widget **удалён** (v3 §7.3): Telegram остаётся
только каналом уведомлений и ботом, но способом входа больше не является.
Провайдер включается ключами владельца инстанса; без ключей он выключен, кнопка в
интерфейсе скрыта, а эндпоинты отвечают `404 provider_disabled`.

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
| `OAUTH_STATE_TTL_SECONDS` | нет | TTL `state`/PKCE, по умолчанию 600 с |
| `WEB_APP_URL` | нет | куда возвращать браузер после callback (по умолчанию `http://localhost:3000`) |

Включатель — наличие обеих переменных пары `GOOGLE_*`. Непустые значения
обязательны: пустая строка считается «не задано». Переменные `TELEGRAM_*` — это
бот-канал уведомлений (см. `docs/PHASE2-TELEGRAM.md`), а не способ входа.

## Эндпоинты

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/api/auth/providers` | публичный | список включённых провайдеров: `{ google }` |
| GET | `/api/auth/google/start` | публичный | 302 на Google (authorization code + PKCE + state) |
| GET | `/api/auth/google/callback` | публичный | обмен кода, проверка `id_token`, вход или привязка, редирект в web |
| GET | `/api/auth/identities` | SessionGuard | привязанные способы входа текущего пользователя |
| GET | `/api/auth/link/google/start` | SessionGuard | начать привязку Google (intent = link) |
| DELETE | `/api/auth/identities/:provider` | SessionGuard | отвязать способ входа |

Эндпоинтов `/api/auth/telegram` и `/api/auth/link/telegram` больше нет;
`ExternalProviderId` (`@puls/shared`) содержит только `'google'`.

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

## Создание пользователя и привязка

* **Вход по существующей привязке** `(provider, subject)` — находим пользователя,
  сессия выдаётся сразу.
* **Google + подтверждённый email** (`email_verified === true`), совпавший с
  существующим пользователем, — привязка к нему; email помечается подтверждённым.
  При `email_verified !== true` привязки нет.
* **Иначе — новый пользователь**: `passwordHash = null`, никнейм генерируется и
  проверяется на уникальность (`puls-<6 base36>`, без эмодзи и пробелов).
  `emailVerifiedAt` ставится, если email подтверждён; без email адрес не задаётся
  (при регистрации по Google почта техническая, см. `docs/PHASE1-AUTH.md`).
* **Пользователи, входившие ранее через Telegram**, остаются в
  `external_identities` со строкой `provider = 'telegram'` — как признак «пароля
  нет». Телеграм-бот при первом сообщении присылает им одноразовую ссылку
  установки логина и пароля (v3 §7).
* **Отвязка** запрещена, если у пользователя нет пароля и это единственная
  привязка → `409 last_login_method`.

Вход по паролю для аккаунтов без пароля даёт `401 invalid_credentials`
(`passwordHash = null`); пользователь задаёт пароль по ссылке из бота.

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

* `components/provider-buttons.tsx` — кнопка Google на `/login` и `/register`;
  блок не рендерится, если провайдер выключен.
* `components/linked-accounts-section.tsx` — секция «Способы входа» в `/settings`.
* Тексты — только в `lib/i18n.ts` (ru + en, ключи совпадают).

## Тесты

* Юнит: `providers.test.ts`, `google.tokens.test.ts` (подпись RS256/exp/iss/aud/kid/alg
  локальными ключами), `nickname.test.ts` (коллизии), `oauth-state.service.test.ts`
  (PKCE, TTL, replay), `google.gateway.test.ts` (PKCE S256 в URL).
* Интеграционные: `test/external-auth.integration.test.ts` — шлюз Google подменён
  фейком (реальных запросов к Google нет), проверяются 404 без ключей, вход,
  привязка по подтверждённому email, replay state, уникальность никнеймов, отвязка
  единственного способа, изоляция по пользователю, а также что `/auth/telegram` и
  `/auth/link/telegram` не существуют.
* E2E: `apps/web/e2e/external-auth.spec.ts` — при выключенном провайдере кнопки
  нет, `/api/auth/google/start` → 404, вход по логину и паролю работает, раздел
  привязок показывает пароль.

## Ограничения

* Хранилище `state` — Valkey при наличии `REDIS_URL`, иначе память процесса
  (в тестах — всегда память). Для нескольких инстансов API без Valkey state не
  разделяется.
* Реальные запросы к Google в автотестах не выполняются.
