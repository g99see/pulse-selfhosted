# Архитектура

Как устроен «Пульс»: схема сервисов, путь запроса, данные, фоновые задачи,
локализация и изоляция пользовательского HTML.

## Схема

```
Браузер ──HTTPS──► Caddy ─┬─ /api/*, /health ─► api:3001 (NestJS) ─► PostgreSQL 16
                          └─ всё остальное   ─► web:3000 (Next.js SSR)   Valkey 8 (кеш, BullMQ)

Браузер ──► usercontent.<домен> (SANDBOX_DOMAIN) ─ только /sandbox/* ─► api (HTML пользователя, строгий CSP)
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

Prisma-модели (36): `User Session EmailVerificationToken Account CheckIn Category
Transaction Budget NotificationRule DailyStat DiscordLink NotificationDelivery TelegramLink
TelegramLinkCode ExternalIdentity InstanceSettings TwoFactorBackupCode
TwoFactorChallenge ExchangeRate Goal GoalDeposit Insight RecurringPayment
Achievement UserAchievement Follow Post Reaction Comment Profile ProfileCard
Report ModerationAction ContentFlag HtmlPage HtmlPageVersion`.

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

## HTML-страница и песочница

- **Хранение:** `HtmlPage` (одна на пользователя) + `HtmlPageVersion` (последние
  10 версий; откат создаёт новую версию).
- **Автопроверка** `checkHtmlPage` (`shared/html-page.ts`): статус
  `ok | blocked | flagged`; `blocked` не публикуется; опционально ClamAV
  (`CLAMAV_*`, пусто — выключено).
- **Отдача:** `html-page/sandbox.controller.ts` на отдельном домене со строгим
  CSP; Caddy срезает cookie в обе стороны и пропускает только `/sandbox/*`.
- **Показ:** `iframe` `sandbox="allow-scripts"` **без** `allow-same-origin`,
  `referrerPolicy="no-referrer"` — у страницы чужой origin.
- **Редактор** (`/page-editor`): textarea + `iframe srcdoc` с теми же атрибутами,
  4 шаблона из `shared/html-templates.ts`, загрузка `.html` (multipart, поле
  `file`, до 2 МБ).

## Короткие адреса `/@nickname`

Next.js резервирует `@` под parallel routes, поэтому литеральный `@` в имени
папки маршрута невозможен. В `next.config.mjs` заданы rewrites:

```
/@:nickname/page → /u/:nickname/page
/@:nickname      → /u/:nickname
```

Новые публичные маршруты профиля кладите в `app/u/[nickname]/…`.

## См. также

- [Разработчикам](/dev/)
- [Как внести вклад](/dev/contributing)
- [Безопасность и песочница](/security/)
- [Администрирование](/admin/)
