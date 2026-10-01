# Фаза 4, блок E — открытый API и вебхуки (ТЗ §4, P2)

Интеграция «Пульса» с Home Assistant, n8n и своими скриптами: личные токены
доступа к публичному API `/api/v1/*` и исходящие вебхуки по доменным событиям.

- Контракт и типы — `packages/shared/src/api-access.ts`.
- Модуль Nest — `apps/api/src/api-access/` (свой модуль, не расширяет
  FinanceModule).
- Таблицы — `api_tokens`, `webhooks`, `webhook_deliveries`
  (миграция `20261001170756_api_tokens_webhooks`).

## Личные токены доступа

Формат токена: `puls_` + 32 случайных байта (base64url, 43 символа). Полное
значение показывается **ровно один раз** при создании; в базе хранится только
SHA-256 (`token_hash`), а в списке — `prefix` (первые 12 символов).

| Метод | Путь | Под чем | Описание |
| --- | --- | --- | --- |
| GET | `/api/api-tokens` | cookie-сессия | Список токенов (без секрета) |
| POST | `/api/api-tokens` | cookie-сессия | Создать токен |
| DELETE | `/api/api-tokens/:id` | cookie-сессия | Отозвать токен (`revoked_at`) |

Тело создания: `{ "name": "Home Assistant", "scopes": ["read"], "expiresAt": null }`
(`scopes`: `read` | `write`; `expiresAt` — ISO-дата или `null`). Ответ содержит
`token` — единственный раз.

## Публичный API `/api/v1/*`

Аутентификация — заголовок `Authorization: Bearer puls_…`. Cookie и CSRF для
Bearer-запросов **не нужны** (токен не привязан к браузеру). Данные — только
владельца токена.

| Метод | Путь | Область | Описание |
| --- | --- | --- | --- |
| GET | `/api/v1/me` | read | Профиль владельца и области токена |
| GET | `/api/v1/transactions` | read | Список транзакций (`accountId`, `from`, `to`, `limit`) |
| POST | `/api/v1/transactions` | write | Создать транзакцию (как `/api/finance/transactions`) |
| GET | `/api/v1/checkins` | read | Список чек-инов (`from`, `to`, `limit`) |
| POST | `/api/v1/checkins` | write | Создать чек-ин |
| GET | `/api/v1/stats/day` | read | Дашборд дня (`date=YYYY-MM-DD`) |

Области: `write` **включает** чтение; `read` записывать не может — 403
`insufficient_scope`. Отозванный или просроченный токен — 401 `unauthorized`.
Частота ограничена на токен: по умолчанию 120 запросов в минуту → 429
`rate_limited` с `retryAfterSeconds`.

### Примеры curl

```bash
TOKEN=puls_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Профиль владельца
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/v1/me

# Новая трата 450 ₽
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"accountId":"<id>","type":"expense","amount":450,"comment":"обед"}' \
  http://localhost:3001/api/v1/transactions

# Чек-ин настроения
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"mood":4}' http://localhost:3001/api/v1/checkins
```

## Вебхуки

| Метод | Путь | Описание |
| --- | --- | --- |
| GET | `/api/webhooks` | Список подписок (без секрета) |
| POST | `/api/webhooks` | Создать подписку, вернуть `secret` один раз |
| DELETE | `/api/webhooks/:id` | Удалить подписку |
| POST | `/api/webhooks/:id/test` | Отправить ping тем же способом |
| GET | `/api/webhooks/:id/deliveries` | Последние 50 доставок |

Создание: `{ "url": "https://example.com/hook", "events": ["transaction.created"], "enabled": true }`.
Секрет подписи шифруется AES-256-GCM (`SecretBox`) и в базе лежит зашифрованным.

### События

`transaction.created`, `checkin.created`, `goal.milestone`,
`achievement.earned`. Эмиттеры — точечные однострочные вызовы
`DomainEvents.emit(...)` в `TransactionsService.create`, `CheckinsService.create`,
`GoalsService.deposit` (при вехе 25/50/75/100) и `AchievementsService.award`.

### Формат запроса

```
POST <url>
Content-Type: application/json
X-Puls-Event: transaction.created
X-Puls-Signature: sha256=<HMAC-SHA256(secret, rawBody) в hex>
X-Puls-Delivery: <id доставки>
```

Тело:

```json
{
  "event": "transaction.created",
  "deliveryId": "clx...",
  "occurredAt": "2026-10-01T12:00:00.000Z",
  "data": { "id": "clx...", "type": "expense", "amount": 450, "currency": "RUB", "date": "..." }
}
```

### Проверка подписи

Node.js:

```js
const crypto = require('node:crypto');

function verifySignature(secret, rawBody, header) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header ?? '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

Python:

```python
import hmac, hashlib

def verify_signature(secret: str, raw_body: bytes, header: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header or "")
```

Сравнивайте подпись по «сырому» телу запроса, до разбора JSON.

### Доставка и повторы

- Первая попытка — сразу при событии; неудачные повторяются с экспоненциальной
  паузой до **5 попыток** (`5s, 10s, 20s, 40s` — `WEBHOOK_RETRY_BASE_MS`).
- Таймаут запроса — 5 с (`WEBHOOK_TIMEOUT_MS`); редиректы не следуются.
- Ретраи идут через BullMQ (Valkey); если Valkey недоступен — таймер в процессе
  (как планировщик уведомлений). Журнал — последние 50 доставок на подписку.
- Статусы: `pending` | `success` | `failed`.

### SSRF-защита

Разрешены только `http(s)`. Запрещены `localhost`, `*.local`/`*.internal`,
приватные (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`,
`100.64/10`), multicast и резервные адреса, а также IPv6 `::1`, `fc00::/7`,
`fe80::/10` и IPv4-mapped. Адрес проверяется при создании, после DNS-резолва и
перед каждой отправкой. Для локальной разработки проверку можно ослабить
флагом `WEBHOOKS_ALLOW_PRIVATE=1` — **только dev, в production не задавать**.

## Интеграции

Home Assistant (создать трату из автоматизации):

```yaml
rest_command:
  puls_expense:
    url: http://puls.local:3001/api/v1/transactions
    method: POST
    headers:
      Authorization: !secret puls_token
      Content-Type: application/json
    payload: '{"accountId":"{{ account }}","type":"expense","amount":{{ amount }}}'
```

Приём вебхуков в Home Assistant — automation с триггером `webhook` на URL
`https://<ha>/api/webhook/<id>` и проверкой `X-Puls-Signature` (см. выше).

n8n: узел **Webhook** как приёмник событий (проверяйте подпись в Function-узле);
узел **HTTP Request** с заголовком `Authorization: Bearer puls_…` для записи
транзакций и чек-инов. Секрет подписи храните в Credentials n8n.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `WEBHOOKS_ALLOW_PRIVATE` | пусто | `1` — разрешить приватные адреса (только dev) |
| `WEBHOOK_TIMEOUT_MS` | `5000` | Таймаут одного запроса вебхука |
| `WEBHOOK_RETRY_BASE_MS` | `5000` | База экспоненциальной паузы ретраев |
| `WEBHOOK_SCHEDULER` | `on` | `off` — выключить планировщик ретраев |
| `API_TOKEN_RATE_LIMIT` | `120` | Запросов на токен в окно |
| `API_TOKEN_RATE_WINDOW` | `60` | Окно лимита, секунды |

## Тесты

```bash
pnpm --filter @puls/api exec vitest run src/api-access/api-token.test.ts \
  src/api-access/webhook-signature.test.ts src/api-access/ssrf.test.ts
pnpm --filter @puls/api exec vitest run test/api-access.integration.test.ts
pnpm --filter @puls/web exec playwright test e2e/api-access.spec.ts
```

Интеграционные тесты поднимают локальный http-сервер на `127.0.0.1`, проверяют
корректность подписи, повтор доставки при 500, переход в `failed` после пяти
неудач, SSRF-отказ и изоляцию данных владельца токена.
