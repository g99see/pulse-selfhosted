# Фаза 4, блок B — AI-помощник: чат, инструменты, предложения, разборы (ТЗ §3.9)

Чат-помощник поверх подключённого AI-ключа (блок A): ответы на вопросы о своих
данных через инструменты **только на чтение** и **только текущего пользователя**,
действия по подтверждению «Применить», разборы недели/месяца. Модуль —
`apps/api/src/ai-assistant/`, импортирует `AiModule` блока A. Публичные схемы и
типы — в `packages/shared/src/ai.ts` (дополнены, ничего не удалялось).

## Хранение

| Модель | Поля | Назначение |
| --- | --- | --- |
| `AiProposal` | `user_id`, `kind` (`budget`/`goal`/`reminder`), `summary`, `payload` (JSONB), `status` (`pending`/`applied`), `result` (JSONB), `applied_at`, `created_at` | Предложение модели до нажатия «Применить» |

- `payload` валидируется Zod-схемой **в момент применения**, сущность создаётся
  существующими сервисами; до «Применить» строка `pending` ни на что не влияет.
- `result` хранит `{ kind, id }` созданного — повторный «Применить» идемпотентен
  (не дублирует бюджет/цель/правило) и возвращает тот же id.
- Таблица с `user_id` внесена в реестр выгрузки/удаления
  (`apps/api/src/account/data-registry.ts`).
- Миграция: `prisma/migrations/20261001150829_ai_proposals`.

## Контракт API (префикс `/api`, всё под `SessionGuard`)

| Метод | Путь | Тело | Ответ |
| --- | --- | --- | --- |
| POST | `/api/ai/chat` | `AiChatRequestSchema` (`message`, `history?`) | `AiChatResponse` (200) |
| POST | `/api/ai/proposals/:id/apply` | — | `AiProposalApplyResponse` (201) |
| POST | `/api/ai/review/preview` | `AiReviewRequestSchema` | `{ preview: AiReviewPreviewDto }` (200) |
| POST | `/api/ai/review` | `AiReviewRequestSchema` | `AiReviewResponse` (200) |

- `AiChatResponse`: `{ reply, proposals: AiProposalDto[], usage: AiUsageDto }`.
- `AiProposalApplyResponse`: `{ proposal, applied: { kind, id } }`.
- `AiReviewRequestSchema`: `{ period: 'week'|'month' (по умолчанию week),
  includeNotes: false, includeName: false }`.
- `AiReviewPreviewDto`: `{ period, provider, isLocal, payloadText,
  includesNotes, includesName }` — `payloadText` это ровно то, что уйдёт провайдеру.
- Ошибки в едином формате `{ code, message }`: `ai_not_configured` (409, из
  `AiProviderService`), `ai_proposal_not_found` (404), `ai_proposal_invalid_payload`
  (400), `validation_error` (400), `unauthorized` (401).

## Инструменты (function calling)

Цикл ограничен 5 итерациями, затем — финальный ответ без инструментов. `userId`
берётся **только из сессии**; аргументы модели не могут выбрать другого
пользователя. Заметки чек-инов и имя в чат-инструменты не попадают.

Чтение: `get_spending_summary`, `list_transactions`, `get_mood`, `get_goals`,
`get_budgets`, `get_achievements` (стрик + достижения).
Предложения (создают `AiProposal` pending, ничего не сохраняют): `propose_budget`,
`propose_goal`, `propose_reminder`.

«Применить» создаёт сущность через существующие сервисы:
`BudgetsService.upsert` (бюджет), `GoalsService.create` (цель),
`NotificationsService.updateRules` (правило напоминания).

## Приватность и рамки

- Системный промпт — `AI_SYSTEM_PROMPT` из shared: без медицинских диагнозов и
  советов по конкретным инвестициям.
- Заметки и имя уходят провайдеру **только** при `includeNotes` / `includeName`;
  по умолчанию `payloadText` их не содержит.
- При тревожном сигнале (свежий инсайт `wellbeing_concern` или серия очень
  низкого настроения) в ответ добавляется блок поддержки — контакты служб из
  `supportResourcesFor` (`shared/insights.ts`).
- `isLocal` в предпросмотре берётся из `AiKeyService.resolve` (провайдер
  `openai_compatible`): данные не покидают сервер.

## Переменные окружения

Новых нет: блок B использует ключи и провайдеров блока A
(`AI_*`/`APP_ENCRYPTION_KEY` описаны в `docs/PHASE4-AI-BACKEND.md`).

## Тесты

```
pnpm --filter @puls/api exec vitest run src/ai-assistant          # 6 юнит-тестов
pnpm --filter @puls/api exec vitest run test/ai-assistant.integration.test.ts  # 7 интеграционных
```

Юнит: изоляция пользователей в инструментах и рендер payload разбора.
Интеграция (реальный PostgreSQL, провайдер подменён фейком — сеть не нужна):
цикл tool-calling, `propose → apply` и идемпотентность, чужое предложение (404),
напоминание, предпросмотр без заметок/имени, изоляция A/B, блок поддержки,
`409 ai_not_configured` без ключа.
