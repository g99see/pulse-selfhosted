# Фаза 1.5 — уведомления

Реализация ТЗ §3.6, §5 (сценарий 1), §7 и критерия приёмки §9 («push с
чек-ином приходит по расписанию с учётом часового пояса и тихих часов; ответ
сохраняется прямо из уведомления»).

## Чистая логика расписания (`@puls/shared/src/notifications.ts`)

Без побочных эффектов — покрыта unit-тестами (`packages/shared/test/notifications.test.ts`).

- `nextDeliveryTime({ now, timezone, times, quietHours })` — ближайший момент
  отправки строго после `now` с учётом IANA-зоны пользователя, расписания и
  тихих часов. Переходы DST пересчитываются по смещению зоны в найденном
  моменте (два прохода), а не по фиксированному сдвигу.
- Расписание по умолчанию — **3 раза в день**: `09:00`, `15:00`, `21:00`
  (утро / день / вечер, сценарий 1). Настраивается от 1 до 6 слотов
  (`timesForCount`).
- Тихие часы по умолчанию **22:00–08:00**, включая переход через полночь.
  Слот, попавший в тихие часы, переносится на их конец (утренний — тот же
  день, поздний вечерний — следующий).
- `deliveryOccurredBetween(window, options)` и `selectDueTypes(rules, window)` —
  выбор «созревших» уведомлений в окне `(from, to]`; на них работает
  планировщик.
- Умное время (ТЗ §3.6): `typicalAnswerTime(samples)` — медиана привычного
  времени ответа; `withMorningTime(times, '09:30')` сдвигает утренний слот.
  Только чистая функция + тест.
- Отдельное включение каждого типа: `defaultNotificationRules()`,
  `isTypeEnabled(rules, type)`.

Типы: `checkins`, `payments`, `budget`, `weekly_report`, `reactions`.
Каналы: `web_push`, `email`.

## Данные (ТЗ §7)

Миграция `prisma/migrations/20261001125821_notifications`.

- `NotificationRule` — `user_id`, `type`, `channel` (`web_push` / `email`),
  `schedule` (JSONB, например `{"times":["09:00","15:00","21:00"]}`),
  `quiet_hours_start` / `quiet_hours_end`, `enabled`. Уникальность
  `(user_id, type, channel)`.
- `PushSubscription` — `user_id`, уникальный `endpoint`, ключи `p256dh` и
  `auth`, `user_agent`.

Правила хранятся лениво: `GET /rules` отдаёт сохранённые значения поверх
значений по умолчанию, `PUT /rules` делает upsert только присланных типов.

## Эндпоинты (префикс `/api/notifications`)

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/vapid-public-key` | публичный | `{ publicKey, enabled }`; `enabled=false` — push отключён |
| GET | `/subscriptions` | SessionGuard | Подписки текущего пользователя |
| POST | `/subscriptions` | SessionGuard | Сохранить подписку (upsert по `endpoint`) |
| DELETE | `/subscriptions` | SessionGuard | Удалить свою подписку по `endpoint` |
| GET | `/rules` | SessionGuard | Эффективные правила по всем пяти типам |
| PUT | `/rules` | SessionGuard | Включение/выключение типов, расписание, тихие часы |

Ошибки: `unauthorized`, `validation_error`, `subscription_not_found`.
Все данные изолированы по `userId` (чужая подписка → 404).

## Web push и VAPID-ключи

- Зависимости: `web-push` (MPL-2.0 — совместима с AGPL-3.0-or-later, проходит
  `pnpm license:check`), `bullmq` (MIT).
- Ключи берутся из окружения: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT` (например `mailto:admin@example.com`).
- Генерация: `pnpm --filter @puls/api vapid:generate`.
- Если ключи не заданы (или некорректны) — отправка отключена, `GET
  /vapid-public-key` честно возвращает `{ publicKey: null, enabled: false }`,
  а в лог идёт предупреждение. API при этом не падает.
- Для dev/тестов используется `InMemoryPushTransport` (outbox доступен через
  `PushService.outbox()`); реальная отправка — `WebPushTransport` поверх
  библиотеки. Просроченные подписки (404/410) удаляются автоматически.

### Новые переменные окружения

`.env.example`, `docker-compose*`, `Dockerfile` и `Caddyfile` не менялись —
добавьте переменные в своё окружение:

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@example.com
NOTIFICATIONS_SCHEDULER=on        # off — выключить планировщик
NOTIFICATIONS_TICK_MS=60000       # период тика, мс
```

`REDIS_URL` уже описан в проекте и используется планировщиком.

## Планировщик

`NotificationsScheduler` (`apps/api/src/notifications/scheduler.ts`):

- Тик раз в минуту выбирает пользователей с `notificationsEnabled`, считает
  `dueDeliveriesForUser` по окну `(прошлый запуск, сейчас]` и отправляет через
  `NotificationDispatcher`.
- В продакшене тик идёт через **BullMQ** (ioredis/Valkey) — повторяемая задача
  `notifications-tick` через `Queue.upsertJobScheduler`.
- Если `REDIS_URL` не задан или Valkey недоступен — планировщик переходит на
  таймер в процессе и пишет предупреждение; API продолжает работать.
- В тестах (`NODE_ENV=test`) автостарт выключен: тесты вызывают `runOnce()`
  напрямую.

**Честно о проверке:** чистая логика выбора due и `runOnce` (с подменёнными
Prisma и диспетчером) покрыты unit-тестами без Valkey. Реальная интеграция с
Valkey/BullMQ (создание очереди и воркера, повторяемая задача) **не проверялась
автоматическими тестами** — для неё нужен доступный Valkey и запущенный API.

## Ответ на чек-ин из уведомления (ТЗ §9)

- Push-payload чек-ина несёт `actions` — кнопки настроения `mood-1`…`mood-5`
  (эмодзи) — и `checkinUrl` (по умолчанию `/api/checkins`).
- Service worker (`apps/web/src/push-handler.ts`, подключён из `sw.ts`):
  показывает уведомление из `push`-события и по нажатию кнопки делает
  `POST /api/checkins` с телом `{ mood }`.
- **CSRF:** API защищён схемой double-submit (cookie + заголовок). Service
  worker не может прочитать `document.cookie`, поэтому сначала получает токен
  через `GET /api/auth/csrf` (сервер отдаёт его и в теле, и в cookie), а затем
  шлёт `X-CSRF-Token` с `credentials: 'include'` — значения совпадают.
- У модуля чек-инов есть и отдельный путь `POST /api/checkins/quick` для того
  же сценария; он принимает `{ mood }` и может быть передан в `checkinUrl`.

## Email-канал

Планировщик для правил с `channel = email` использует существующий
`MailService.sendNotification(to, { subject, text, kind, link })` — новый метод,
добавленный без изменения прежних (`sendEmailVerification`, `outbox`).
Тексты писем и push собирают чистые функции `messages.ts`
(`buildPushPayload`, `buildNotificationEmail`, `checkinGreeting`).

## Web

- Карточка «Уведомления» на странице профиля/настроек (`/app/profile`):
  переключатели по типам, тихие часы (с/до), кнопка «Включить push»
  (`Notification.requestPermission` + `pushManager.subscribe` с публичным
  VAPID-ключом) и «Отключить push».
- Все строки интерфейса — в `src/lib/i18n.ts` (ключи `notifications.*`, ru/en
  синхронны).
- Утилиты `src/lib/push.ts` (VAPID-ключ → `applicationServerKey`, подписка) и
  клиент `src/lib/notifications-client.ts`.

## Тесты

- `packages/shared/test/notifications.test.ts` — расписание, часовой пояс,
  тихие часы (в т.ч. через полночь), DST, умное время, правила типов, due-выбор.
- `apps/api/src/notifications/*.test.ts` — правила (`due`), тексты (`messages`),
  VAPID/транспорт (`push.service`), планировщик (`scheduler`, чистая логика).
- `apps/api/test/notifications.integration.test.ts` — эндпоинты против
  PostgreSQL (правила, подписки, изоляция по пользователю).
- `apps/web/test/push.test.ts` — парсинг payload, кнопки настроения, сборка
  запроса на чек-ин, регистрация обработчиков service worker.
