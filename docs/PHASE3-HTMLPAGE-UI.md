# Фаза 3, блок D — UI HTML-страницы (ТЗ §3.8)

Редактор пользовательской HTML-страницы профиля, готовые шаблоны, история
версий и публичная вкладка на отдельном домене песочницы.

## Что сделано

| Область | Файл |
| --- | --- |
| Готовые шаблоны (визитка, портфолио, вишлист, «моя цель») + обёртка автопроверки | `packages/shared/src/html-templates.ts` |
| Тесты шаблонов (безопасность, размер, каноническая автопроверка) | `packages/shared/test/html-templates.test.ts` |
| Сетевой слой и адрес песочницы | `apps/web/src/lib/html-page-client.ts` |
| Компонент публичной вкладки (iframe песочницы) | `apps/web/src/components/public-html-page.tsx` |
| Редактор: код слева, предпросмотр справа, вкладки на мобильном | `apps/web/src/app/(app)/page-editor/page.tsx` |
| Публичная страница `/@nickname/page` | `apps/web/src/app/u/[nickname]/page/page.tsx` |
| Rewrite короткого адреса | `apps/web/next.config.mjs` |
| E2E: шаблон → сохранение → откат версии | `apps/web/e2e/html-page.spec.ts` |
| Строки интерфейса (ru/en) | `apps/web/src/lib/i18n.ts` (ключи `htmlPage.*`, `app.nav.page`) |
| Ссылки: навигация и профиль | `apps/web/src/components/app-shell.tsx`, `apps/web/src/app/(app)/app/profile/page.tsx` |

## Контракт API (общий пакет блока C)

Типы и автопроверка — в `packages/shared/src/html-page.ts` (публикует блок C):
`HtmlPageDto`, `HtmlPageVersionDto`, `HtmlPageResponse`, `HtmlPageVersionsResponse`,
`HtmlPageSaveSchema`, `checkHtmlPage`, `HTML_PAGE_MAX_BYTES`, `HTML_PAGE_VERSION_LIMIT`.

Клиент (`html-page-client.ts`) обращается к эндпоинтам:

| Метод | Назначение |
| --- | --- |
| `GET /api/html-page` | Текущая страница (`exists=false` — ещё нет) |
| `PUT /api/html-page` | Сохранить код (`{ html, note?, published? }`) |
| `POST /api/html-page/upload` | Загрузить `.html` (multipart, поле `file`) |
| `GET /api/html-page/versions` | Последние 10 версий |
| `POST /api/html-page/versions/:id/restore` | Откат к версии |
| `DELETE /api/html-page` | Удалить страницу с историей |
| `GET <SANDBOX_URL>/sandbox/:nickname` | Публичная отдача страницы |

`NEXT_PUBLIC_SANDBOX_URL` — базовый адрес домена песочницы. Если переменная не
задана, iframe использует относительный путь `/sandbox/:nickname` (dev без
отдельного домена). В `.env` есть `SANDBOX_DOMAIN=usercontent.localhost`.

## Изоляция пользовательской страницы (ТЗ §3.8)

- **Редактор**: предпросмотр — `iframe srcdoc` с `sandbox="allow-scripts"`,
  без `allow-same-origin`, `referrerPolicy="no-referrer"`.
- **Публичная вкладка**: iframe `src=SANDBOX_URL/sandbox/:nickname`, те же
  `sandbox` и `referrerpolicy="no-referrer"`.

Оба фрейма считаются чужим origin, поэтому чужие cookie и данные основного
сайта недоступны. Скрипты страницы при этом работают.

## Короткий адрес `/@nickname/page`

Next.js резервирует `@` за parallel routes (`isParallelRouteSegment`), и литеральный
`@` в дереве маршрутов выразить нельзя (Vercel issue #52391: единственный путь —
rewrite). Поэтому в `next.config.mjs` есть rewrite:

```
/@:nickname/page  →  /u/:nickname/page
/@:nickname       →  /u/:nickname        (публичный профиль, блок A)
```

Реальный маршрут HTML-страницы — `src/app/u/[nickname]/page/page.tsx`, рядом с
профилем блока A (`src/app/u/[nickname]/page.tsx`): проверяет никнейм по
`NICKNAME_REGEX` и рендерит `PublicHtmlPage`. В карточке `html_page` публичного
профиля добавлена ссылка «Открыть на отдельном домене» на эту вкладку.

## Автопроверка в интерфейсе

После сохранения/загрузки редактор показывает статус из ответа API
(`page.checkStatus`: `ok | blocked | flagged`) и список причин
(`page.checkReasons`). Заблокированные причины — красным, помеченные — как
предупреждения. Данные берутся из ответа API, а не пересчитываются на клиенте;
живой предпросмотр дополнительно использует `auditHtmlTemplate` из общего пакета.

## Тесты

```
pnpm --filter @puls/shared test          # шаблоны: безопасность, размер, автопроверка
pnpm --filter @puls/web e2e -- html-page # шаблон → сохранение → откат → /@nickname/page
```

E2E требует живого API с эндпоинтами `html-page` (блок C) и dev-outbox писем.
