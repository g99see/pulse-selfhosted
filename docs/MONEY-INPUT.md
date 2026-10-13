# «Пульс» — ввод денег без загрузки банковской выписки (iPhone)

> **Статус (обновлено).** Вариант «Apple Shortcuts + наш API» и связанные с ним
> быстрый ввод по URL и область токена `transactions:quick` были реализованы
> (см. историю) и затем **отклонены и удалены**: в коде нет эндпоинта
> `POST /api/v1/transactions/quick`, нет области `transactions:quick`, нет страниц
> `/quick` и `/shortcut-setup` (см. CHANGELOG «Удалено»). Оставшийся и поддерживаемый
> путь быстрого ввода — cookie-сессия `POST /api/finance/transactions/quick` (шторка
> «быстрый ввод» в приложении). Документ сохранён как исследование: разделы ниже,
> помеченные ⛔, относятся к отклонённому подходу и не описывают текущий код.

ТЗ §3.2 требует импорт выписки из CSV. С iPhone это неудобно: файл надо получить в
банковском приложении, сохранить в «Файлы»/iCloud, затем вручную выбрать в браузере.
Для повседневных трат нужен ввод «в момент покупки», за пару секунд. Ниже —
альтернативы, оценённые по усилию, приватности, UX на iPhone и надёжности; факты
проверены по источникам (ссылки в конце). Целевая платформа — iOS 16.4+ Safari/PWA,
self-hosted без платных сервисов.

## Сводка

| Вариант | Усилие | Приватность | UX на iPhone | Надёжность |
| --- | --- | --- | --- | --- |
| Apple Shortcuts + наш API | низкое | высокая (только наш сервер) | отличный (Share Sheet / Siri / иконка) | высокая (штатный HTTP-клиент) |
| Быстрый ввод по URL + ярлык | низкое | высокая | хороший | высокая |
| OCR чека через Shortcut (on-device) | низкое | высокая (на сервер идёт только текст) | хороший | средняя (raw-текст, нужен парсер) |
| Email-приём уведомлений банка | среднее | средняя (транзит через почту) | хороший | средняя-низкая (нет стандарта формата) |
| Open banking (Enable Banking restricted) | высокое | средняя (данные у агрегатора) | пассивный | высокая по данным |
| Триггер Wallet / Apple Pay | низкое | высокая | автоматический | низкая (баги Apple) |

## Разбор

**1. ⛔ Apple Shortcuts + личный токен (основной вариант — ОТКЛОНЁН, удалён).** Шорткат выполняет действие
`Get Contents of URL` → HTTP POST с JSON-телом и заголовком `Authorization: Bearer puls_…`.
Поддержка POST/JSON/своих заголовков штатная; ограничения: нет OAuth2, таймаут ~60 с,
не следует редиректам (и теряет заголовок). Запуск: (а) из меню «Поделиться» —
выделенный текст («кофе 250») приходит как Shortcut Input; (б) по фразе Siri — ненадёжно
(Siri «съедает» первые слова, плохо узнаёт имя шортката); (в) иконкой на домашнем экране.
Автоматизация по транзакции Apple Pay/Wallet появилась только в **iOS 17**, умеет
запускаться без подтверждения, передаёт Merchant/Amount, но Apple признаёт баги (пустой
Amount, срабатывает лишь на NFC-tap при разблокированном телефоне) → годится как черновик,
не как единственный источник.

**2. ⛔ Быстрый ввод по URL + ярлык на домашний экран (ОТКЛОНЁН, удалён).** Страница `/quick?text=…` (или приём
из буфера обмена) добавляется на домашний экран вручную (Share → Add to Home Screen).
Дёшево, работает на всех iOS, служит резервом для Shortcuts. Минус: iOS PWA не умеет свой
URL-scheme и universal links; открыть уже установленную PWA из Shortcuts можно лишь через
`webapp://` при точном совпадении URL. Web Share Target (`share_target`) в iOS Safari не
поддерживается — PWA не станет целью в «Поделиться».

**3. OCR чека через Shortcut.** Действие `Extract Text from Image` (Live Text, iOS 15+,
on-device Vision, есть русский/украинский/датский) распознаёт чек офлайн и отдаёт текст;
на сервер уходит **только текст** — приватно и без нагрузки на VPS. Серверный OCR слабее:
по бенчмарку SROIE CER — Tesseract 33.6%, PaddleOCR 20.5%, docTR 19.7%, при этом RAM на
малом VPS ограничена, а парсер полей нужен всё равно. Вывод: распознавать на устройстве.

**4. Email-приём уведомлений банка.** Персональный catch-all адрес (`user-xxxx@puls.домен`)
→ webhook. На 2026 бесплатно и с webhook реально только **Cloudflare Email Routing + Email
Workers** (входящие без лимита; Free Worker — 10 мс CPU на вызов, 100k запросов/день).
Mailgun/SendGrid/Postmark/ImprovMX на бесплатном тарифе либо без routes, либо без webhook
(SendGrid закрыл free 27.05.2025). Пересылка ломает SPF (спасает SRS), выживает только DKIM;
единого формата банковских писем нет → парсер на каждый банк. Резерв — self-hosted IMAP
(imapflow + IDLE), но Gmail/Outlook теперь требуют OAuth.

**5. Open banking.** Бесплатного мультипользовательского пути нет: GoCardless/Nordigen
закрыл регистрацию (июль 2025), Tink/Salt Edge/Plaid — коммерческие или sandbox-only.
Единственная лазейка — Enable Banking «Restricted Production»: бесплатно, реальные данные,
но только по счетам, которые привязал сам владелец (один пользователь, не продуктовая
фича). Покрытие Дании/ЕС (2700+ банков) есть; Украина требует лицензии TPP (постановление
НБУ №80). Пересогласие SCA каждые 90–180 дней.

**6. ⛔ Триггер Wallet (Apple Pay) — ОТКЛОНЁН, удалён.** iOS 17+, нестабилен — включать как дополнение (см. п.1).

## Рекомендация (ранжировано)

1. ⛔ **Apple Shortcuts + scoped-токен** *(отклонён, удалён)* — основной канал: бесплатно, приватно, нативно.
2. ⛔ **Быстрый ввод по URL / ярлык на домашний экран** *(отклонён, удалён)* — резерв, покрывает все iOS.
3. **OCR чека через `Extract Text from Image`** — дополнение, тот же endpoint.
4. **Email через Cloudflare Email Workers** — для «пусть приходит само».
5. **Enable Banking restricted** — опция для одного владельца в ЕС/Дании.
6. **Wallet-триггер** — включить, когда Apple починит стабильность.

## MVP (строить первым)

> ⛔ **Отклонён и удалён.** Пункты 1–4 ниже описывают снятую реализацию
> (эндпоинт `/api/v1/transactions/quick`, область `transactions:quick`, страница
> `/quick`). В коде их нет. Поддерживается только cookie-сессия
> `POST /api/finance/transactions/quick`.

1. `POST /api/v1/transactions/quick` + идемпотентность (см. ниже); переиспользует
   `parseQuickTransaction` из `@puls/shared` (уже есть в `POST /api/finance/transactions/quick`).
2. Scoped-токен для iOS — область **только** на быстрый ввод.
3. Шаблон Shortcut «Пульс — трата» (Share Sheet + Siri + иконка), экспортируется как
   файл `.shortcut` и раздаётся в `docs/`.
4. Страница `/quick` + инструкция «добавить на домашний экран».
5. Далее по этапам: OCR-шорткат, затем email-приём.

## API

> ⛔ **Отклонён и удалён.** Эндпоинт `POST /api/v1/transactions/quick`, область
> `transactions:quick` и идемпотентность ниже в коде отсутствуют.

**Эндпоинт:** `POST /api/v1/transactions/quick`. Аутентификация — `Authorization: Bearer ***
(тот же формат, что в `api_tokens`: `puls_` + 32 байта base64url; в базе только SHA-256).
Cookie/CSRF не нужны.

**Модель токена:** добавить область `transactions:quick` (а не широкую `write`), чтобы токен
из шортката не мог читать список, удалять или менять категории. В интерфейсе создания токена —
пресет «iPhone / Shortcuts».

**Тело запроса:**

```json
{
  "text": "кофе 250",
  "date": "2026-10-13",
  "accountId": null,
  "source": "shortcut"
}
```

`text` разбирается общим парсером («кофе 250» → расход 250, категория «Еда»; «зарплата +80000»
→ доход). Для OCR- и Share-Sheet-сценариев допускаются явные поля: `type`, `amount`,
`categoryId`, `comment`, `currency`.

**Идемпотентность:** заголовок `Idempotency-Key` (обязателен для шорткатов; при отсутствии
сервер считает `sha256(userId | text | date)` в окне суток). Уникальный индекс
`(user_id, idempotency_key)`; повторный запрос возвращает ту же транзакцию, баланс не меняется.
Это критично из-за ретраев Shortcut при таймауте и возможных двойных срабатываний.

**Ответ:**

```json
{ "id": "clx…", "type": "expense", "amount": 250, "categoryName": "Еда", "duplicate": false }
```

Ошибки — единый формат `{ code, message }`: `unauthorized`, `insufficient_scope`,
`validation_error`, `rate_limited`.

## Источники

- Apple Shortcuts — триггер Transaction: https://support.apple.com/guide/shortcuts/transaction-trigger-apd65c67538a/ios ·
  ограничения API: https://support.apple.com/guide/shortcuts/api-limitations-apd891a6c84e/ios ·
  запрос к API: https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios ·
  автоматизации и «Run Immediately»: https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/ios ·
  Live Text / языки: https://support.apple.com/en-gb/120004
- iOS PWA: https://firt.dev/notes/pwa-ios · Web Push 16.4: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ ·
  Web Share Target: https://caniuse.com/web-share-target · камера/файлы: https://web.dev/articles/media-capturing-images
- Open banking: https://bankaccountdata.gocardless.com/new-signups-disabled · https://enablebanking.com/docs/faq/ ·
  Украина (НБУ №80): https://bank.gov.ua/en/payments/open-banking
- Email: https://developers.cloudflare.com/email-service/platform/pricing/ · https://developers.cloudflare.com/email-routing/limits/ ·
  SendGrid free закрыт: https://support.sendgrid.com/hc/en-us/articles/35270136965403 · IMAP: https://imapflow.com/docs/
- OCR (бенчмарк SROIE): https://imagetotable.ai/references/receipt-ocr-benchmark-results
