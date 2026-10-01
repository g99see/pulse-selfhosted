# Фаза 4, блок C — web UI AI-помощника (ТЗ §3.9)

Интерфейс AI-помощника по API-ключу: чат, разбор недели/месяца, настройки
личного ключа и админка экземпляра. Только `apps/web` (+ точечно `i18n.ts` и
`app-shell.tsx`). Данные и схемы — из `@puls/shared/ai.ts`.

## Файлы

- `src/lib/ai-client.ts` — сетевой слой (`aiApi`) по контракту блока A/B и
  чистые помощники: `aiErrorKey`, `aiTestErrorKey`, `formatAiTokens`,
  `formatAiCost`.
- `src/app/(app)/ai/page.tsx` — экран AI: чат, карточки предложений, разбор
  недели/месяца, расход за месяц. Показывается только при `status.enabled`.
- `src/components/ai-key-section.tsx` — секция настроек личного ключа
  (провайдер, ключ `type=password`, `baseUrl` для `openai_compatible`, модель,
  «Сохранить» / «Проверить подключение» / «Удалить», расход за месяц).
- `src/app/(app)/admin/ai/page.tsx` — админка AI: общий ключ, лимит токенов,
  таблица расхода по пользователям. Только роль `admin`.
- `src/components/app-shell.tsx` — пункты навигации `/ai` (только при
  `status.enabled`) и `/admin/ai` (только админ); статус грузится лёгким
  запросом, при ошибке AI считается выключенным.
- `src/app/(app)/settings/page.tsx` — точечный патч: рендер `AiKeySection`.
- `src/lib/i18n.ts` — строки AI на ru и en.
- `test/ai-client.test.ts` — unit-тесты помощников.
- `e2e/ai.spec.ts` — e2e с подменой AI-эндпоинтов через `page.route`.

## Поведение

- Ключ никогда не отдаётся в браузер: показываем только `…last4`. При пустом
  поле ключа и уже сохранённом ключе поле в запрос не добавляется (сервер
  сохраняет прежний ключ).
- Чат хранит историю на клиенте (до 20 реплик) и отправляет её полем `history`.
  Ответ помощника выводится в `role="log"` с `aria-live="polite"`.
- Предложения (`budget`/`goal`/`reminder`) сохраняются только по кнопке
  «Применить»; после применения помечаются «Применено».
- Разбор: сначала «Что уйдёт провайдеру» (`payloadText` + пометка `isLocal`),
  затем «Получить разбор». Заметки и имя уходят только по отдельным галочкам.
- Коды ошибок `ai_not_configured` (409), `ai_limit_reached` (409/429),
  `ai_provider_error` (502) переводятся через `aiErrorKey`.
- Контраст: на `--puls-primary` используется `--puls-on-primary`.

## Проверки

```bash
pnpm --filter @puls/web test
pnpm --filter @puls/web typecheck
pnpm --filter @puls/web build
npx playwright test ai   # из apps/web, нужны Postgres и Valkey
```
