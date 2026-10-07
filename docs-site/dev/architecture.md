# Архитектура

Как устроен «Пульс»: схема сервисов, путь запроса, данные, фоновые задачи,
локализация.

## Схема

```
Браузер ──HTTPS──► Caddy ─┬─ /api/*, /health ─► api:3001 (NestJS) ─► PostgreSQL 16
                          └─ всё остальное   ─► web:3000 (Next.js SSR)   Valkey 8 (кеш, BullMQ)
```

Контейнеры compose: `postgres`, `valkey`, `api`, `web`, `backup`, `caddy`.
У всех есть healthcheck; миграции Prisma применяет контейнер `api` при старте.

## Путь запроса

1. **Клиент.** Web вызывает API через `authFetch`
   (`apps/web/src/lib/auth-client.ts`): `credentials: 'include'`, для мутаций
   добавляет заголовок `X-CSRF-Token` из cookie `puls_csrf`; при `csrf_failed`
   один раз обновляет токен и повторяет запрос.
2. **Серверный guard кабинета.** `app/(app)/layout.tsx` читает cookie
   `puls_session` и спрашивает `/api/auth/me` по внутреннему адресу
   `SERVER_API_URL`; без сессии → `/login`, без онбординга → `/onboarding`.
3. **API.** Контроллер защищён `SessionGuard` (данные только текущего
   пользователя), тело валидируется `ZodValidationPipe` схемой из `@puls/shared`.
4. **Ошибки.** Единый формат `{ code, message }` через `common/http-error.ts`;
   web переводит `code` в текст (ключи `auth.error.<code>`).

## Данные

Prisma-модели: `User Session EmailVerificationToken Account CheckIn Category
Transaction Budget NotificationRule DailyStat DiscordLink NotificationDelivery TelegramLink
TelegramLinkCode ExternalIdentity InstanceSettings
PasswordToken ExchangeRate Goal GoalDeposit Insight RecurringPayment
Achievement UserAchievement TimeCapsule Habit HabitLog DaySummaryLink` и др. (полный список — `apps/api/prisma/schema.prisma`).
Социальных сущностей (подписки, лента, публичные профили, семья, челленджи) нет — данные одного пользователя другому не показываются.

- Суммы — `Decimal(14,2)` в БД, числа в API.
- **Любая таблица с `user_id` обязана быть в `account/data-registry.ts`** — иначе
  экспорт/удаление аккаунта её пропустит (и тест реестра упадёт).
- Миграции — `apps/api/prisma/migrations/<timestamp>_<фича>/`.

## Фоновые задачи

BullMQ на Valkey с таймерным фолбэком: напоминания о чек-инах и платежах
(`notifications/scheduler`), регулярные платежи (`finance/recurring.scheduler`),
недельный разбор (`insights/weekly.scheduler`). Захват работы — условный
`updateMany` по старому `nextRunAt` (**CAS**), чтобы повторный тик не создавал
дубли.

## i18n

Все строки интерфейса — в `apps/web/src/lib/i18n.ts` (`ru` и `en`,
плейсхолдеры вида `{name}`). Тест `no-hardcoded-text.test.ts` падает на любой
русской строке в `.tsx`, не прошедшей через `t()`. Язык выбирается по cookie
`puls_locale` → `Accept-Language` → `ru`.

## См. также

- [Разработчикам](/dev/)
- [Как внести вклад](/dev/contributing)
- [Безопасность](/security/)
- [Администрирование](/admin/)
