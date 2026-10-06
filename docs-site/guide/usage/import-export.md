# Импорт и экспорт

Пульс умеет загружать банковскую выписку из CSV и выгружать все ваши данные в
JSON или CSV, а также полностью удалять аккаунт. Импорт — ТЗ §3.2, экспорт и
удаление — ТЗ §3.1 и §6.

## Импорт CSV-выписки

Экран `/finance/import` (ссылка — в заголовке «Финансы»). Порядок работы: загрузка
файла → выбор и правка сопоставления колонок → таблица предпросмотра → выбор
счёта → подтверждение → итог импорта.

### Форматы и разбор

Парсеры и определение колонок — чистые функции `@puls/shared/src/import.ts`:

| Функция | Что делает |
| --- | --- |
| `detectDelimiter(text)` | Выбирает `,`, `;` или `\t` по первым строкам, игнорируя разделители внутри кавычек |
| `parseCsv(text, delimiter?)` | Парсер RFC 4180: кавычки, экранирование `""`, переводы строк внутри полей, BOM, CRLF/LF |
| `detectHeaderRow(rows)` | Есть ли строка заголовков (по ключевым словам или по составу данных) |
| `detectColumnMapping(headers, sample)` | Автоопределение колонок `date / amount / description / type / debit / credit` по русским и английским заголовкам, с запасным вариантом по данным |
| `parseImportDate(value)` | `dd.MM.yyyy`, `dd/MM/yyyy`, `dd-MM-yyyy`, `yyyy-MM-dd`, `yyyy.MM.dd` (+ необязательное время), с проверкой реальности даты |
| `parseImportAmount(value)` | `1 234,56`, `-450.00`, `1,234.56`, `1.234,56`, `(500,00)`, неразрывные пробелы и символы валют |
| `buildImportPreview(...)` | Строки предпросмотра: дата, сумма (по модулю), тип, описание, категория через `guessCategoryName`, пометка дублей |
| `importRowKey(date, amount, description)` | Канонический ключ строки |

Тип операции определяется из колонки типа, колонок дебет/кредит или знака суммы.
Категории подбираются по описанию среди системных и своих категорий
пользователя. Суммы хранятся как `Decimal(14,2)`.

### Дубли и идемпотентность

Предпросмотр помечает дубли в двух случаях: **внутри файла** и **против уже
существующих** транзакций — по ключу `дата|сумма|описание`.

Для импорта у каждой строки считается `sha256(accountId|ключ)` и сохраняется в
`transactions.import_hash` (уникальный индекс `(user_id, import_hash)`).
Повторный импорт того же файла в тот же счёт **пропускает уже созданные строки**,
дубликаты считаются, а баланс не меняется. Транзакции создаются пачкой в одной
Prisma-транзакции вместе с обновлением баланса счёта.

### Лимиты и кодировка

- Файл больше 2 МБ → `413 import_too_large`.
- Больше 10 000 строк данных → `400 import_too_many_rows`.
- Кодировку снимает web: сначала `TextDecoder('utf-8', { fatal: true })`, при
  ошибке — `TextDecoder('windows-1251')` (`apps/web/src/lib/import-client.ts`).

### API импорта

| Метод | Путь | Назначение |
| --- | --- | --- |
| POST | `/api/finance/import/preview` | Предпросмотр: `{ csv, delimiter?, hasHeader?, mapping? }` |
| POST | `/api/finance/import/commit` | Импорт: `{ csv, accountId, delimiter?, hasHeader?, mapping? }` |

Предпросмотр отвечает `{ delimiter, hasHeader, headers, mapping, rows, summary, limits }`,
где `summary = { total, valid, duplicates, errors }`, а строка —
`{ rowNumber, date, amount, type, description, categoryName, duplicate, error }`
(`error` — `invalid_date | invalid_amount | null`). Импорт отвечает
`{ imported, duplicates, invalid, total, balance }`.

## Экспорт данных

Страница настроек `/settings`, секция «Данные и приватность»
(`src/components/data-privacy-section.tsx`). Кнопки «Экспорт JSON» и «Экспорт
CSV» скачивают файл, не уводя со страницы (blob + `Content-Disposition`).

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/api/account/export?format=json` | Единый JSON-документ со всеми данными пользователя |
| GET | `/api/account/export?format=csv` | ZIP-архив с CSV по сущностям |
| DELETE | `/api/account` | Полное удаление аккаунта с подтверждением |

### Формат JSON

```json
{
  "format": "puls.export",
  "version": 1,
  "generatedAt": "2026-10-01T13:20:00.000Z",
  "user": { "email": "…", "nickname": "…" },
  "counts": { "transactions": 1 },
  "data": {
    "accounts": [], "categories": [], "transactions": [], "budgets": [],
    "checkIns": [], "notificationRules": [], "dailyStats": []
  }
}
```

Версия формата — константа `EXPORT_FORMAT_VERSION` в `@puls/shared`; растёт при
несовместимом изменении структуры документа.

### Формат CSV

ZIP-архив (метод STORE, собственный писатель `src/account/zip.ts` — без внешних
зависимостей) с файлами:

```
users.csv  accounts.csv  categories.csv  transactions.csv
budgets.csv  check_ins.csv  notification_rules.csv  daily_stats.csv
```

- Заголовки стабильны: колонки берутся из `information_schema.columns` в порядке
  объявления.
- Экранирование по RFC 4180 (кавычки, запятые, `\r\n`), разделитель строк CRLF.
- Защита от инъекции формул: текстовые значения, начинающиеся с `=`, `+`, `-`,
  `@`, таба или CR, получают ведущую одинарную кавычку. Числа и даты,
  сгенерированные сервером, не портятся (отрицательная сумма остаётся числом).
- Заголовки ответа: `Content-Disposition: attachment; filename="puls-export-<никнейм>-<ГГГГ-ММ-ДД>.json|.zip"`,
  `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.

## Реестр таблиц (`data-registry`)

`src/account/data-registry.ts` — единственное место, где перечислено, что входит
в выгрузку:

- `EXPORT_TABLES` — `users` (по `id`) и таблицы по `user_id`;
- `EXCLUDED_USER_TABLES` — секреты с причиной: `sessions`,
  `email_verification_tokens`, `discord_link_codes`, `telegram_link_codes`;
- `isSecretColumn()` отсекает колонки `password_hash`, `token_hash`, `*secret`,
  `auth`, `p256dh`, `private_key` в любой таблице.

Колонки выбираются динамически, поэтому новая таблица выгружается без правки
кода — достаточно добавить её в реестр. Интеграционный тест «каждая таблица с
`user_id` покрыта» падает, пока новая таблица не внесена в выгрузку или в явные
исключения. Подробнее о структуре — [Архитектура](/dev/architecture).

## Удаление аккаунта

- **Подтверждение**: пароль (проверка через Argon2) и собственный никнейм.
  Коды ошибок: `confirmation_mismatch` (400), `invalid_password` (403),
  `rate_limited` (429), `unauthorized` (401).
- Удаление идёт в одной транзакции по всем таблицам с `user_id` (обнаруживаются
  в `information_schema`, поэтому каскад полный даже при отстающем реестре
  выгрузки), затем по `users`.
- Сессии удаляются вместе с пользователем, cookie `puls_session` и `puls_csrf`
  сбрасываются, ответ — `204 No Content`.
- Журнал (`Logger`) пишет строку без персональных данных: только необратимый хеш
  идентификатора, число таблиц и строк, IP.
- Защита от повторов: лимит попыток и идемпотентная транзакция; повторный вызов
  после успеха не проходит аутентификацию (`401`).

Модальное окно удаления — на `/settings`; после успеха происходит переход на
`/login`.

## Ограничение частоты

- Экспорт: 5 выгрузок за 15 минут на пользователя (`429 rate_limited`).
- Удаление: 5 попыток за 15 минут. Лимитер — `RateLimitService` (Valkey или
  in-memory).

## См. также

- [Финансы](./finance) — счета, транзакции и категории.
- [Статистика и рекомендации](./stats-insights) — что попадает в дневные агрегаты.
- [Архитектура](/dev/architecture) — реестр таблиц и структура модулей.
- [Настройка (.env)](/guide/configuration) — переменные окружения сервиса.
