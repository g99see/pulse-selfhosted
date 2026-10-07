# Фаза 2 — 2FA и вход через Telegram: удаление (ТЗ §7, v3)

Раньше здесь описывалась двухфакторная аутентификация (TOTP) и вход через
Telegram (Login Widget). В v3 §7 **и то, и другое удалено**. Документ фиксирует,
что убрано и чем заменено; актуальное поведение входа — в `docs/PHASE1-AUTH.md`.

## Что удалено

### 2FA (TOTP) — удалена полностью

- Нет эндпоинтов `/api/auth/2fa`, `/api/auth/2fa/setup|enable|disable` и
  `/api/auth/login/2fa`; `POST /api/auth/login` больше не возвращает
  `twoFactorRequired`/`challengeToken`.
- Нет кода: `apps/api/src/auth/two-factor.service.ts`, `crypto/totp.ts`,
  `crypto/base32.ts`, `crypto/qr.ts`, веб-компонента `two-factor-section.tsx`,
  e2e-спеки `two-factor.spec.ts`.
- Миграция `apps/api/prisma/migrations/20261007110000_remove_2fa_tg_login/`
  удаляет колонки `two_fa_enabled`, `two_fa_secret`, `two_fa_confirmed_at`,
  `two_fa_last_step` и таблицы `two_factor_backup_codes`, `two_factor_challenges`.
  `down.sql` возвращает структуру пустой: секреты и резервные коды восстановить
  нельзя, у всех 2FA остаётся выключенной.
- `two_factor_backup_codes` и `two_factor_challenges` исключены из реестра
  выгрузки (`account/data-registry.ts`); `two_fa_secret` больше в схеме нет.
- `APP_ENCRYPTION_KEY` **больше не связан с 2FA**. Он по-прежнему нужен для
  хранения секретов: AI-ключи, секреты вебхуков открытого API, тела капсул.

### Вход через Telegram — удалён

- Нет эндпоинтов `/api/auth/telegram` и `/api/auth/link/telegram`; нет
  Telegram Login Widget и файла `components/telegram-login-button.tsx`.
- `GET /api/auth/providers` возвращает только `{ google }`; `ExternalProviderId`
  в `@puls/shared` — только `'google'`.
- Telegram остаётся **каналом уведомлений** и ботом (чек-ины, быстрые траты,
  команда `/password`); вход через него невозможен.
- Строки `external_identities` с `provider = 'telegram'` **сохранены** — только
  как признак «пользователь входил через Telegram и пароля не задал» (см. ниже).

## Чем заменено

- **Вход** — логин (никнейм) **или** почта плюс пароль (`POST /api/auth/login`).
- **Регистрация** — прямо с начального экрана, без обязательного email
  (`POST /api/auth/register`); почта нужна только для сброса пароля письмом.
- **Пароль** — минимум 8 символов, хранится хешем Argon2id.
- **Забыли пароль** — одноразовая ссылка `POST /api/auth/forgot-password`
  (письмо, если почта указана) либо команда `/password` в боте.
- **Сброс/установка по ссылке** — токен живёт **30 минут**, в БД хранится только
  SHA-256 (`password_tokens`); при установке нового пароля все сессии
  пользователя завершаются.
- **Пользователи, входившие только через Telegram** (у них `passwordHash = null`):
  бот при первом сообщении сам присылает одноразовую ссылку «задайте логин и
  пароль» (setup-токен) и после следующего входа показывается напоминание.
  ТЗ ожидает ссылку с TTL 24 часа — в коде те же 30 минут.

## Лимиты

- Вход: 5 попыток на логин/почту и 100 на IP за 15 минут → `429 rate_limited`.
- Ссылка-установка в боте: не чаще 1 раза в 10 минут на чат.

## Тесты и миграция

- Удалены `two-factor.integration.test.ts`, `totp.test.ts`, `base32`/`qr.test.ts`,
  `telegram.test.ts`, `two-factor-client.test.ts`, e2e `two-factor.spec.ts`.
- `packages/shared/src/two-factor.ts` и его схемы удалены.
- В `apps/api/test/external-auth.integration.test.ts` закреплено, что
  `/auth/telegram` и `/auth/link/telegram` больше не существуют.
- Миграции: `20261007110000_remove_2fa_tg_login` (удаление 2FA и входа через
  Telegram) и `20261007112000_optional_email_password_tokens` (почта
  необязательна, таблица `password_tokens` для ссылок сброса/установки).
