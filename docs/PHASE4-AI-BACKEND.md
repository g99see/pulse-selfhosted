# Фаза 4, блок A — AI-бэкенд: ключи, провайдеры, учёт токенов (ТЗ §3.9)

Хранение AI-ключей, адаптеры провайдеров, учёт токенов и админ-настройки
экземпляра. Публичный контракт и схемы — в `packages/shared/src/ai.ts`
(не менялись). Внутренний контракт для блока B — `apps/api/src/ai/ai.types.ts`.

## Хранение

| Где | Поля | Назначение |
| --- | --- | --- |
| `InstanceSettings` (дополнены) | `ai_provider`, `ai_api_key_encrypted`, `ai_api_key_last4`, `ai_base_url`, `ai_model`, `ai_monthly_token_limit` | Общий ключ экземпляра, провайдер, модель и лимит токенов на пользователя в месяц |
| `UserAiKey` | `user_id` (PK), `provider`, `api_key_encrypted`, `api_key_last4`, `base_url`, `model` | Личный ключ пользователя — один на пользователя, приоритетнее общего |
| `AiUsage` | `user_id`, `month` (YYYY-MM), `tokens_in`, `tokens_out`, `cost_usd` | Расход по месяцам; `@@unique([user_id, month])`, накапливается upsert-ом |

- Ключи хранятся **только зашифрованными** AES-256-GCM через
  `apps/api/src/crypto/secret-box.ts` (`v1.<iv>.<tag>.<ciphertext>`). Наружу
  уходят лишь последние 4 символа; сам ключ не попадает ни в DTO, ни в логи.
  Если мастер-ключ недоступен (production без `APP_ENCRYPTION_KEY`) — запись
  ключа отвечает `503 ai_key_storage_unavailable`.
- Обе таблицы с `user_id` внесены в реестр выгрузки/удаления данных
  (`apps/api/src/account/data-registry.ts`); колонка `api_key_encrypted`
  помечена секретной и в выгрузку не попадает.
- Миграция: `prisma/migrations/20261001150619_ai_assistant`.

## Контракт API (префикс `/api`)

### Пользователь (`AiController`, `SessionGuard`)

| Метод | Путь | Тело | Ответ |
| --- | --- | --- | --- |
| GET | `/api/ai/status` | — | `{ status: AiStatusDto }` |
| PUT | `/api/ai/key` | `AiKeySetInput` | `{ status: AiStatusDto }` |
| DELETE | `/api/ai/key` | — | 204, личный ключ удалён (возврат к общему) |
| POST | `/api/ai/key/test` | — | `AiTestResponse` (проверка текущего ключа) |

### Админ (`AiAdminController`, `@Roles('admin')`)

| Метод | Путь | Тело | Ответ |
| --- | --- | --- | --- |
| GET | `/api/admin/ai/settings` | — | `{ settings: AiInstanceSettingsDto }` |
| PUT | `/api/admin/ai/settings` | `AiInstanceSettingsInput` | `{ settings: AiInstanceSettingsDto }` |
| POST | `/api/admin/ai/settings/test` | `AiInstanceSettingsInput` | `AiTestResponse` (проверка до сохранения) |
| GET | `/api/admin/ai/usage?month=YYYY-MM` | — | `AiUsageAdminResponse`; без `month` — текущий месяц |

Пустой или отсутствующий `apiKey` оставляет прежний ключ; `null` в
`provider`/`baseUrl`/`model`/`monthlyTokenLimit` очищает поле. Роуты совпадают
с клиентом блока C (`apps/web/src/lib/ai-client.ts`).

## Выбор ключа и выполнение (ТЗ §3.9)

`AiKeyService.resolve(userId)` — личный ключ пользователя приоритетнее общего
ключа экземпляра; иначе `source: 'none'` и AI выключен. `AiProviderService.complete`
— единственная точка для блока B:

```ts
complete(userId: string, req: AiCompletionRequest): Promise<AiCompletionResult>
// { system; messages: AiMessage[]; tools?: AiTool[]; maxTokens? }
// → { text; toolCalls: AiToolCall[]; tokensIn; tokensOut }
```

Порядок: разрешить ключ → проверить месячный лимит (только для общего ключа) →
вызвать адаптер → записать `AiUsage` (`cost_usd` по `estimateAiCostUsd`).

Ошибки (`httpError`): `ai_not_configured` (409), `ai_limit_reached` (429,
достигнут `monthlyTokenLimit` общего ключа), `ai_provider_error` (502, с полем
`reason`). Тела ответов провайдера не логируются и не пробрасываются.

## Провайдеры

Адаптеры в `apps/api/src/ai/ai-providers.ts` за интерфейсом
`AiProviderAdapter.complete`; сеть скрыта за `AiHttpClient` (токен `AI_HTTP`),
поэтому в тестах реальных запросов нет.

| Провайдер | Базовый адрес по умолчанию | Модель по умолчанию |
| --- | --- | --- |
| `anthropic` | `https://api.anthropic.com` | `claude-3-5-haiku-latest` |
| `openai` | `https://api.openai.com/v1` | `gpt-4o-mini` |
| `openrouter` | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` |
| `openai_compatible` | задаётся пользователем (`baseUrl`) | `llama3.1` |

Поддерживаются инструменты (tool calling): Anthropic — `tool_use`/`tool_result`,
OpenAI-совместимые — `tool_calls`/role `tool`. Классификация ошибок:
401/403 → `invalid_key`, 404 → `model_not_found`, 429 → `limit_reached`,
сеть → `unreachable`, иначе `unknown`.

## Переменные окружения

Новых переменных нет: используется уже существующий `APP_ENCRYPTION_KEY`
(мастер-ключ сейфа, ТЗ §6). Без него в production запись AI-ключей недоступна,
в dev/test работает явный dev-ключ.

## Тесты

```bash
pnpm --filter @puls/api exec vitest run src/ai/ai-providers.test.ts          # адаптеры (13)
pnpm --filter @puls/api exec vitest run test/ai.integration.test.ts          # API + БД (14)
```

Интеграционные тесты проверяют шифрование ключа в БД и отсутствие утечки,
приоритет личного ключа над общим, учёт и накопление токенов, месячный лимит,
проверку подключения, админ-права (403) и таблицу расхода. Сеть подменена
фейком `AI_HTTP` — реальных вызовов провайдеров нет.
