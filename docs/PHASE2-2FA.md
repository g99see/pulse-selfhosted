# Фаза 2 — Двухфакторная аутентификация (TOTP, ТЗ §6)

Кратко: TOTP по RFC 6238 (HMAC-SHA1, шаг 30 с, 6 цифр, окно ±1), секрет
хранится зашифрованным AES-256-GCM, резервные коды — только хешами, шаг входа
между паролем и кодом — одноразовым пропуском. Всё реализовано на `node:crypto`
без новых зависимостей.

## Новые переменные окружения

| Переменная | Назначение | Обязательность |
|---|---|---|
| `APP_ENCRYPTION_KEY` | мастер-ключ AES-256-GCM, ровно 32 байта в base64 | в production обязательна для 2FA |

Поведение без ключа:
- `NODE_ENV=production` и нет `APP_ENCRYPTION_KEY` → 2FA **недоступна**: `POST /api/auth/2fa/setup`
  отвечает `503 two_factor_unavailable`, а `GET /api/auth/2fa` возвращает `available: false`
  (UI показывает явное предупреждение). Никакого «тихого» отката к небезопасному ключу.
- dev/test → используется явный тестовый ключ `DEV_TEST_KEY_BASE64` (детерминированный,
  только для не-production; см. `apps/api/src/crypto/secret-box.ts`).

`.env.example`, Caddyfile и docker-compose не менялись: переменную описываем здесь.

## API (все под `SessionGuard`, кроме входа)

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/auth/2fa` | статус `{ enabled, available }` |
| `POST` | `/api/auth/2fa/setup` | сгенерировать секрет, вернуть `secret`, `otpauthUri`, `qrDataUrl` |
| `POST` | `/api/auth/2fa/enable` | `{ code }` → включить 2FA и выдать 10 резервных кодов |
| `POST` | `/api/auth/2fa/disable` | `{ password, code }` → выключить 2FA |
| `POST` | `/api/auth/login` | при включённой 2FA: `200 { twoFactorRequired: true, challengeToken }` **без сессии** |
| `POST` | `/api/auth/login/2fa` | `{ challengeToken, code }` → сессия (код TOTP или резервный) |

Статус и настройка строго изолированы по пользователю (берём `req.user` из сессии).

## Хранение и безопасность

- `users.two_fa_secret` — секрет TOTP в формате `v1.<iv>.<tag>.<ciphertext>`
  (AES-256-GCM, случайный IV 12 байт, аутентификация GCM). В открытом виде не хранится.
- `users.two_fa_last_step` — последний принятый шаг TOTP. Повтор кода в окне (и код,
  которым подтверждали включение) отклоняется: принимается только шаг строго больше.
- `two_factor_backup_codes` — SHA-256 от нормализованного резервного кода; выставляется
  `used_at` при использовании, повтор не проходит.
- `two_factor_challenges` — SHA-256 от токена пропуска, TTL 5 минут, одноразовый.
- Лимит попыток второго фактора через существующий `RateLimitService`:
  5 на пропуск и 20 на IP за 15 минут → `429 rate_limited`.

## Криптомодули (`apps/api/src/crypto/`)

- `base32.ts` — RFC 4648 без зависимостей.
- `totp.ts` — `generateTotpSecret`, `hotp`, `totp`, `matchTotpStep`, `otpauthUri`.
  Покрыт векторами Приложения B RFC 6238 (8 и 6 цифр).
- `secret-box.ts` — `SecretBox`, `resolveMasterKey`, DI-провайдер `SecretBoxService`.
  Переиспользуется будущими AI-ключами.
- `qr.ts` — минимальный QR-энкодер (byte-режим, версии 1–10, L/M/Q/H, автоподбор
  версии и маски). Матрицы сверены с независимым декодером (zxing-cpp). Если ссылка
  не помещается — `qrDataUrl: null`, UI всё равно показывает секрет и URI для ручного ввода.

## Выгрузка данных (ТЗ §3.1, §6)

`two_factor_backup_codes` и `two_factor_challenges` добавлены в `EXCLUDED_USER_TABLES`,
`code_hash` — в шаблоны секретных колонок; `two_fa_secret` уже был скрыт в
`EXPORT_TABLES` для `users`. Есть unit-тест на покрытие реестра и интеграционный тест,
что выгрузка не содержит секретов 2FA.

## UI

- `apps/web/src/components/two-factor-section.tsx` — секция на `/settings`: QR/секрет,
  ввод кода, показ резервных кодов, выключение по паролю и коду.
- `apps/web/src/app/login/page.tsx` — при `twoFactorRequired` показывается шаг ввода
  кода (TOTP или резервного) и вход завершается.
- Строки — только в `apps/web/src/lib/i18n.ts` (ru + en, одинаковый набор ключей).

## Тесты

- Юнит: `src/crypto/totp.test.ts` (векторы RFC 6238), `secret-box.test.ts`, `qr.test.ts`.
- Интеграционные: `test/two-factor.integration.test.ts` — setup/enable/disable, вход с
  2FA, отказ входа без сессии, повтор TOTP и резервного кода, чужой секрет, лимит 429,
  шифрование секрета в БД, отсутствие секретов в выгрузке.
- Web: `test/two-factor-client.test.ts`, проверки i18n и отсутствия зашитых строк.
- E2E: `apps/web/e2e/two-factor.spec.ts` — включение через API и вход с вторым фактором
  в браузере; отдельно проверяется, что вход без 2FA не изменился.

## Миграция

`apps/api/prisma/migrations/20261001155200_two_factor/migration.sql` — колонки
`two_fa_secret`, `two_fa_confirmed_at`, `two_fa_last_step` и две таблицы. Создана
отдельно, чтобы не тянуть чужие незакоммиченные изменения схемы.
