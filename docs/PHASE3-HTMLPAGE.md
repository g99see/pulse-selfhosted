# Фаза 3, блок C — HTML-страница профиля: backend (ТЗ §3.8, §6, §10)

Хранение, версии, автопроверка и публичная отдача пользовательского HTML
с отдельного домена песочницы. Контракт и автопроверка — в общем пакете
`packages/shared/src/html-page.ts` (UI блока D строит по нему интерфейс).

## Хранение

| Модель | Поля | Назначение |
| --- | --- | --- |
| `HtmlPage` | `user_id` (unique), `published`, `current_version_id`, `created_at`, `updated_at` | Одна страница на пользователя и её текущая версия |
| `HtmlPageVersion` | `page_id`, `user_id`, `html` (до 2 МБ), `note`, `check_status`, `check_reasons`, `created_at` | История версий |

- Хранятся **последние 10 версий** (`HTML_PAGE_VERSION_LIMIT`); более старые
  удаляются при каждом сохранении.
- Сохранение и загрузка создают **новую версию**; откат — тоже новая версия
  (история не переписывается).
- Обе таблицы с `user_id` внесены в реестр выгрузки/удаления данных
  (`apps/api/src/account/data-registry.ts`).
- Миграция: `prisma/migrations/20261001144022_html_page`.

## Контракт API (префикс `/api`, всё под `SessionGuard`)

| Метод | Путь | Тело | Ответ |
| --- | --- | --- | --- |
| GET | `/api/html-page` | — | `{ page: HtmlPageDto }` |
| PUT | `/api/html-page` | `{ html, note?, published? }` | `{ page: HtmlPageDto }` — новая версия |
| POST | `/api/html-page/upload` | multipart, поле `file` (один `.html`) | `{ page: HtmlPageDto }` (201) |
| GET | `/api/html-page/versions` | — | `{ versions: HtmlPageVersionDto[] }` (до 10) |
| POST | `/api/html-page/versions/:id/restore` | — | `{ page: HtmlPageDto }` (201) |
| DELETE | `/api/html-page` | — | 204, страница и история удаляются |

`HtmlPageDto`: `exists, published, nickname, sandboxUrl, currentVersionId,
checkStatus, checkReasons, html, sizeBytes, updatedAt`.
`HtmlPageVersionDto`: `id, note, checkStatus, checkReasons, sizeBytes, createdAt, html`.

Ошибки — единый формат `{ code, message, ... }`: `validation_error` (400),
`invalid_file_type` (400), `file_required` (400), 413 (файл > 2 МБ),
`version_not_found` (404), `unauthorized` (401).

### Публикация

`published` в PUT управляет видимостью. Если автопроверка вернула `blocked`,
флаг принудительно сбрасывается: **заблокированная страница не публикуется**.

## Автопроверка при сохранении

Чистая функция `checkHtmlPage(html, { sandboxDomain })` в общем пакете.
«Внешний» адрес — любой хост, кроме домена песочницы; относительные пути свои.

| Код | Severity | Что ловит |
| --- | --- | --- |
| `external_form_action` | blocked | `<form action>` на сторонний адрес |
| `password_form_external` | blocked | парольный ввод в форме на внешний хост |
| `meta_refresh` | blocked (с `url=`) / flagged | `<meta http-equiv="refresh">` |
| `auto_redirect` | blocked | `location =` / `location.replace/assign` в скрипте |
| `suspicious_link` | blocked | внешняя ссылка со словами «вход/пароль/банк» |
| `javascript_url` | flagged | ссылка `javascript:` |
| `external_script` | flagged | внешний `<script src>` (CSP его заблокирует) |
| `external_request` | flagged | `fetch`/XHR/`sendBeacon` на внешний адрес |
| `antivirus` | blocked | ClamAV нашёл сигнатуру |

Итог: любой `blocked` → `blocked`; иначе есть причины → `flagged`; иначе `ok`.

### Антивирус (ClamAV)

Интерфейс `ClamAvScanner` (`apps/api/src/html-page/clamav.ts`). Реализация
выбирается по `CLAMAV_HOST`:

- пусто (по умолчанию) — `NoopClamAvScanner`, пишет понятный лог о том, что
  проверка отключена;
- `host:port` — `ClamAvInstreamScanner`, TCP-клиент clamd по протоколу INSTREAM.

## Публичная отдача с домена песочницы (ТЗ §3.8, §6)

`GET /sandbox/:nickname` — контроллер `SandboxController`, вне префикса `/api`
(исключён в `app.setup.ts`). Caddy на домене `SANDBOX_DOMAIN` проксирует сюда
только `/sandbox/*`, режет cookie в обе стороны (`-Cookie`, `-Set-Cookie`) и
ставит CSP-backstop.

Страница отдаётся, только если одновременно:

- `published = true` и есть текущая версия;
- `checkStatus` текущей версии ≠ `blocked`;
- карточка профиля `html_page` видна публично (если карточки нет — решает
  `published`; `private`/`subscribers` не отдаются анонимно);
- контент не скрыт модератором (`ContentFlag`, `target_type = html_page`).

Заголовки ответа:

```
Content-Type: text/html; charset=utf-8
Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline';
  style-src 'unsafe-inline' https:; img-src https: data:;
  form-action 'none'; base-uri 'none'; frame-ancestors <основной домен>
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cache-Control: no-store
```

Cookie основного сайта в песочницу не попадают и ею не выставляются.

## Переменные окружения

| Переменная | Назначение |
| --- | --- |
| `SANDBOX_DOMAIN` | Домен песочницы (уже был) — ссылка и определение «внешних» адресов |
| `DOMAIN` | Основной домен — CSP `frame-ancestors` |
| `PUBLIC_ORIGIN` | Origin основного сайта — CSP-backstop в Caddy |
| `CLAMAV_HOST` | `host:port` clamd; пусто — noop-заглушка |

## Тесты

```
pnpm --filter @puls/shared test test/html-page.test.ts      # автопроверка и схемы
pnpm --filter @puls/api test src/html-page/clamav.test.ts   # адаптер ClamAV (фейковый clamd)
pnpm --filter @puls/api test test/html-page.integration.test.ts  # API, 2 МБ, 10 версий, откат, изоляция, CSP
```

Интеграционные тесты проверяют лимит 2 МБ, вытеснение старых версий, откат
через новую версию, изоляцию пользователей, публикацию/блокировку и точные
заголовки песочницы (CSP, nosniff, referrer, отсутствие `Set-Cookie`).
