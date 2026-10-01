# Фаза 1.1 — аутентификация и онбординг

Реализация ТЗ §3.1 и §6: вход по email+паролю, серверные сессии, подтверждение
email, ограничение частоты входов, CSRF и онбординг из 4 шагов.

## Эндпоинты (префикс `/api`)

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/auth/csrf` | — | Выдаёт CSRF-cookie `puls_csrf` (double-submit) |
| POST | `/auth/register` | +CSRF | Регистрация, письмо с подтверждением |
| POST | `/auth/login` | +CSRF | Вход, cookie `puls_session` |
| POST | `/auth/verify-email` | +CSRF | Подтверждение по токену, сразу логинит |
| POST | `/auth/verify-email/resend` | +CSRF | Повторное письмо (без раскрытия адресов) |
| GET | `/auth/me` | сессия | Текущий пользователь и статус онбординга |
| POST | `/auth/logout` | сессия | Завершение текущей сессии |
| GET | `/auth/sessions` | сессия | Список активных сессий (без хешей токенов) |
| DELETE | `/auth/sessions/:id` | сессия | Отзыв своей сессии |
| PUT | `/auth/onboarding` | сессия | Сохраняет 4 шага и создаёт первый счёт |
| GET | `/auth/dev/outbox` | dev | Письма из in-memory транспорта (для e2e) |

Ошибки в едином формате `{ code, message }`: `email_taken`, `nickname_taken`,
`validation_error`, `email_not_verified`, `invalid_credentials`, `invalid_token`,
`rate_limited`, `csrf_failed`, `unauthorized`.

## Безопасность (ТЗ §6)

- Пароли — Argon2id (`argon2`), параметры OWASP, переопределяются `ARGON2_*`.
- В БД хранится только SHA-256 от токена сессии/письма; cookie httpOnly,
  `SameSite=Lax`, `Secure` в production.
- CSRF — глобальный guard для всех мутирующих запросов (`X-CSRF-Token` == cookie).
- Ограничение входов: 5 попыток на email и 100 на IP за 15 минут (`Retry-After`).
  Хранилище — Valkey (ioredis) с автоматическим откатом на in-memory.

## Переменные окружения

`DATABASE_URL`, `REDIS_URL`, `CORS_ORIGIN`, `WEB_APP_URL` (ссылка в письме),
`MAIL_TRANSPORT=console|smtp`, `SMTP_URL`, `MAIL_FROM`, `SESSION_TTL_DAYS=30`,
`EMAIL_VERIFY_TTL_HOURS=24`, `RATE_LIMIT_STORE=memory` (для тестов), `API_INTERNAL_URL`
(адрес API для серверных запросов Next), `ARGON2_MEMORY_COST`/`ARGON2_TIME_COST`/`ARGON2_PARALLELISM`.

## Тесты

```bash
pnpm --filter @puls/shared test    # 31 юнит-тест (схемы)
pnpm --filter @puls/api test       # 22 юнит + 18 интеграционных (схема puls_test)
pnpm --filter @puls/web test       # 16 юнит-тестов
pnpm e2e                           # Playwright: регистрация → email → онбординг → кабинет
```

Интеграционные тесты идут в отдельную схему `puls_test` той же БД
(`TEST_DATABASE_URL` переопределяет хост, схема задаётся принудительно).
