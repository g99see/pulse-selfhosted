# Фаза 2 — импорт банковской выписки из CSV (ТЗ §3.2)

Реализовано: парсер CSV, автоопределение разделителя и колонок, предпросмотр
с подбором категорий и пометкой дублей, импорт пачкой с идемпотентностью и
обновлением баланса счёта, экран `/finance/import`.

## Общая логика (`@puls/shared`, `src/import.ts`)

Чистые функции, общие для API и web (покрыты unit-тестами):

- `detectDelimiter(text)` — выбирает `,`, `;` или `\t` по первым строкам,
  игнорируя разделители внутри кавычек.
- `parseCsv(text, delimiter?)` — парсер RFC 4180: кавычки, экранирование `""`,
  переводы строк внутри полей, BOM, CRLF/LF.
- `detectHeaderRow(rows)` — есть ли строка заголовков (по ключевым словам или
  по составу данных).
- `detectColumnMapping(headers, sample)` — автоопределение колонок
  `date | amount | description | type | debit | credit` по русским и английским
  заголовкам, с запасным вариантом по данным (даты/числа).
- `parseImportDate(value)` — `dd.MM.yyyy`, `dd/MM/yyyy`, `dd-MM-yyyy`,
  `yyyy-MM-dd`, `yyyy.MM.dd` (+ необязательное время); проверяет реальность даты.
- `parseImportAmount(value)` — `1 234,56`, `-450.00`, `1,234.56`, `1.234,56`,
  `(500,00)`, неразрывные пробелы и символы валют.
- `buildImportPreview(rows, { mapping, hasHeader, existingKeys })` — строки
  предпросмотра: дата, сумма (по модулю), тип (из колонки типа, колонок
  дебет/кредит или знака суммы), описание, категория через `guessCategoryName`,
  пометка дублей (внутри файла и против существующих по `дата|сумма|описание`).
- `importRowKey(date, amount, description)` — канонический ключ строки.
- Лимиты: `IMPORT_MAX_BYTES = 2 МБ`, `IMPORT_MAX_ROWS = 10 000`.
- Zod-схемы `ImportPreviewRequestSchema` и `ImportCommitRequestSchema`.

## API (`apps/api/src/finance/import.service.ts`)

Оба маршрута под `SessionGuard`, данные только текущего пользователя.

### `POST /api/finance/import/preview`

Тело: `{ csv, delimiter?, hasHeader?, mapping? }`.

Ответ: `{ delimiter, hasHeader, headers, mapping, rows, summary, limits }`,
где `summary = { total, valid, duplicates, errors }`, а каждая строка —
`{ rowNumber, date, amount, type, description, categoryName, duplicate, error }`
(`error` — `invalid_date | invalid_amount | null`).

### `POST /api/finance/import/commit`

Тело: `{ csv, accountId, delimiter?, hasHeader?, mapping? }`.

Ответ: `{ imported, duplicates, invalid, total, balance }`.

Идемпотентность: у каждой строки считается `sha256(accountId|ключ)` и
сохраняется в `transactions.import_hash`. Повторный импорт того же файла в тот
же счёт пропускает уже созданные строки (уникальный индекс `(user_id,
import_hash)`), дубликаты считаются, баланс не меняется. Транзакции создаются
пачкой в одной Prisma-транзакции вместе с обновлением баланса счёта.

Суммы хранятся как `Decimal(14,2)`, категории подбираются по описанию среди
системных и своих категорий пользователя.

### Лимиты и кодировка

- Файл больше 2 МБ → `413 import_too_large`.
- Больше 10 000 строк данных → `400 import_too_many_rows`.
- Кодировку снимает web: `TextDecoder('utf-8', { fatal: true })`, при ошибке —
  `TextDecoder('windows-1251')` (`apps/web/src/lib/import-client.ts`).
- Тело запроса до 4 МБ: в `configureApp` зарегистрирован JSON-парсер
  `express.json({ limit: '4mb' })` (стандартных 100 КБ не хватает на 2 МБ CSV).

## Миграция

`apps/api/prisma/migrations/20261001160100_transaction_import_hash` — колонка
`transactions.import_hash` и уникальный индекс `(user_id, import_hash)`.

## Web (`apps/web`)

- `src/app/(app)/finance/import/page.tsx` — загрузка файла, выбор и правка
  сопоставления колонок, таблица предпросмотра, выбор счёта, подтверждение и
  итог импорта. Ссылка на экран — в заголовке «Финансы».
- `src/lib/import-client.ts` — чтение и декодирование файла, вызовы
  `/import/preview` и `/import/commit`.
- Строки интерфейса — в `src/lib/i18n.ts` (`finance.import.*`, ru + en).

## Тесты

- Unit: `packages/shared/test/import.test.ts` (парсер, колонки, даты, суммы,
  предпросмотр, дубли, лимиты).
- Unit: `apps/web/test/import-client.test.ts` (UTF-8/windows-1251, лимит 2 МБ).
- Интеграционные: `apps/api/test/import.integration.test.ts` (предпросмотр,
  импорт и баланс, дебет/кредит, идемпотентность, изоляция пользователей,
  лимиты).
- E2E: `apps/web/e2e/import.spec.ts` (загрузка файла → предпросмотр →
  подтверждение → транзакции в финансах).
