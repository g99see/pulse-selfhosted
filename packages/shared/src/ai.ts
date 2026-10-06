// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * AI-помощник по API-ключу (ТЗ §3.9): общий контракт API и web.
 * Ключ никогда не уходит в браузер — в DTO только последние 4 символа.
 * Два уровня ключа: общий ключ экземпляра (админ, лимит токенов на пользователя
 * в месяц) и личный ключ пользователя (приоритетнее).
 */
import { z } from 'zod';
import { NotificationTypeSchema } from './notifications';

export const AI_PROVIDERS = [
  'anthropic',
  'openai',
  'openrouter',
  'opencode_go',
  'opencode_zen',
  'google',
  'deepseek',
  'mistral',
  'groq',
  'xai',
  'openai_compatible',
] as const;
export const AiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProvider = z.infer<typeof AiProviderSchema>;

/**
 * Для openai_compatible (Ollama, LM Studio) ключ может быть пустым, baseUrl обязателен.
 * Для остальных провайдеров (пресеты) baseUrl необязателен — переопределяет адрес по умолчанию.
 */
export const AiKeySetSchema = z
  .object({
    provider: AiProviderSchema,
    apiKey: z.string().trim().max(500).default(''),
    baseUrl: z.string().trim().url().max(300).optional(),
    model: z.string().trim().min(1).max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.provider === 'openai_compatible') {
      if (!value.baseUrl)
        ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'Укажите адрес сервера' });
    } else if (value.apiKey.length < 8) {
      ctx.addIssue({ code: 'custom', path: ['apiKey'], message: 'Ключ слишком короткий' });
    }
  });
export type AiKeySetInput = z.infer<typeof AiKeySetSchema>;
export type AiKeySetValues = z.input<typeof AiKeySetSchema>;

/** Откуда берётся ключ: личный приоритетнее общего. */
export type AiKeySource = 'user' | 'instance' | 'none';

export interface AiUsageDto {
  /** Месяц учёта, YYYY-MM. */
  month: string;
  tokensIn: number;
  tokensOut: number;
  /** Примерная стоимость в USD. */
  costUsd: number;
  /** Лимит токенов в месяц на пользователя по общему ключу; null — без лимита. */
  limitTokens: number | null;
}

/** Состояние AI для текущего пользователя. enabled=false → AI-функции скрыты. */
export interface AiStatusDto {
  enabled: boolean;
  source: AiKeySource;
  provider: AiProvider | null;
  model: string | null;
  /** Последние 4 символа ключа (личного), иначе null. Сам ключ не отдаётся. */
  last4: string | null;
  baseUrl: string | null;
  usage: AiUsageDto;
}
export interface AiStatusResponse {
  status: AiStatusDto;
}

export interface AiTestResponse {
  ok: boolean;
  /** Короткая причина при ok=false (без ключа и тел ответов провайдера). */
  error?: 'invalid_key' | 'unreachable' | 'model_not_found' | 'limit_reached' | 'unknown';
}

export const AiChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(4000),
});
export type AiChatMessage = z.infer<typeof AiChatMessageSchema>;

export const AiChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  /** Предыдущие реплики диалога (клиент хранит историю сам). */
  history: z.array(AiChatMessageSchema).max(20).default([]),
});
export type AiChatRequest = z.infer<typeof AiChatRequestSchema>;

/** Действие, которое помощник предлагает; сохраняется только после «Применить». */
export type AiProposalKind = 'budget' | 'goal' | 'reminder';

/** Статус предложения: pending — ждёт «Применить», applied — применено. */
export type AiProposalStatus = 'pending' | 'applied';

export interface AiProposalDto {
  id: string;
  kind: AiProposalKind;
  /** Человекочитаемое описание для кнопки «Применить». */
  summary: string;
  /** Параметры действия (схема зависит от kind, валидируется при применении). */
  payload: Record<string, unknown>;
  status: AiProposalStatus;
}

export interface AiChatResponse {
  reply: string;
  proposals: AiProposalDto[];
  usage: AiUsageDto;
}

export const AiReviewRequestSchema = z.object({
  period: z.enum(['week', 'month']).default('week'),
  /** Заметки уходят провайдеру только с отдельной галочкой (ТЗ §3.9). */
  includeNotes: z.boolean().default(false),
  /** Имя/никнейм — только с отдельной галочкой. */
  includeName: z.boolean().default(false),
});
export type AiReviewRequest = z.infer<typeof AiReviewRequestSchema>;
export type AiReviewValues = z.input<typeof AiReviewRequestSchema>;

/** Что именно уйдёт провайдеру — показывается до отправки. */
export interface AiReviewPreviewDto {
  period: 'week' | 'month';
  provider: AiProvider | null;
  /** Локальный провайдер (Ollama/LM Studio): данные не покидают сервер. */
  isLocal: boolean;
  /** Текстовое представление данных, которые будут отправлены. */
  payloadText: string;
  includesNotes: boolean;
  includesName: boolean;
}
export interface AiReviewPreviewResponse {
  preview: AiReviewPreviewDto;
}
export interface AiReviewResponse {
  review: string;
  proposals: AiProposalDto[];
  usage: AiUsageDto;
}

/** Админка: настройки AI экземпляра (ТЗ §2, §3.9). */
export const AiInstanceSettingsSchema = z.object({
  provider: AiProviderSchema.nullable().optional(),
  /** Новый общий ключ; пусто/не передан — оставить прежний. */
  apiKey: z.string().trim().max(500).optional(),
  baseUrl: z.string().trim().url().max(300).nullable().optional(),
  model: z.string().trim().min(1).max(120).nullable().optional(),
  /** Лимит токенов на пользователя в месяц; null — без лимита. */
  monthlyTokenLimit: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
});
export type AiInstanceSettingsInput = z.infer<typeof AiInstanceSettingsSchema>;

export interface AiInstanceSettingsDto {
  provider: AiProvider | null;
  last4: string | null;
  baseUrl: string | null;
  model: string | null;
  monthlyTokenLimit: number | null;
}
export interface AiInstanceSettingsResponse {
  settings: AiInstanceSettingsDto;
}

export interface AiUsageRowDto {
  userId: string;
  nickname: string;
  month: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}
export interface AiUsageAdminResponse {
  month: string;
  rows: AiUsageRowDto[];
}

/** Базовые адреса по умолчанию; для openai_compatible задаётся пользователем (UI показывает как подсказку). */
export const AI_DEFAULT_BASE_URL: Record<AiProvider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  opencode_go: 'https://opencode.ai/zen/go/v1',
  opencode_zen: 'https://opencode.ai/zen/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  xai: 'https://api.x.ai/v1',
  openai_compatible: '',
};

/** Модели по умолчанию, если в настройках не задана своя. */
export const AI_DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-3-5-haiku-latest',
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  opencode_go: 'deepseek-v4-flash',
  opencode_zen: 'deepseek-v4-flash',
  google: 'gemini-3.8-flash',
  deepseek: 'deepseek-flash',
  mistral: 'mistral-small-latest',
  groq: 'openai/gpt-oss-20b',
  xai: 'grok-4.7',
  openai_compatible: 'llama3.1',
};

/** Примерная цена за 1 млн токенов (USD) для учёта расхода; локальные — 0. */
export const AI_PRICE_PER_MTOK: Record<AiProvider, { in: number; out: number }> = {
  anthropic: { in: 3, out: 15 },
  openai: { in: 2.5, out: 10 },
  openrouter: { in: 3, out: 12 },
  // OpenCode Go — фиксированная подписка: расход не считаем.
  opencode_go: { in: 0, out: 0 },
  // OpenCode Zen — оплата по факту, цена зависит от модели: консервативная оценка.
  opencode_zen: { in: 3, out: 12 },
  google: { in: 0.3, out: 2.5 },
  deepseek: { in: 0.3, out: 1.2 },
  mistral: { in: 0.2, out: 0.6 },
  groq: { in: 0.15, out: 0.6 },
  xai: { in: 2, out: 6 },
  openai_compatible: { in: 0, out: 0 },
};

/** Примерная стоимость запроса в USD по токенам и провайдеру. */
export function estimateAiCostUsd(
  provider: AiProvider,
  tokensIn: number,
  tokensOut: number,
): number {
  const price = AI_PRICE_PER_MTOK[provider];
  const cost = (tokensIn * price.in + tokensOut * price.out) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Системный промпт: рамки помощника (ТЗ §3.9). */
export const AI_SYSTEM_PROMPT =
  'Ты — помощник сервиса «Пульс» по личным финансам и самочувствию. Отвечай на языке пользователя, кратко и по делу. ' +
  'Данные получай только через инструменты и только текущего пользователя. ' +
  'Не ставь медицинских диагнозов и не давай советов по конкретным инвестициям. ' +
  'При тревожных сигналах (стойко плохое настроение, мысли о вреде себе) мягко предложи обратиться к специалисту или на линию поддержки. ' +
  'Бюджет, цель или напоминание только предлагай через инструмент предложения — сохраняет их пользователь кнопкой «Применить».';

/**
 * Системный промпт с валютой пользователя: все суммы инструментов — в базовой валюте,
 * без этой строки модель додумывает валюту (например, ставит ₽ при счёте в кронах).
 */
export function aiSystemPromptFor(baseCurrency: string): string {
  return (
    `${AI_SYSTEM_PROMPT} ` +
    `Все суммы из инструментов — в базовой валюте пользователя ${baseCurrency}; ` +
    `указывай именно её (код ${baseCurrency} или её знак), не подставляй другую валюту.`
  );
}

/* ----- Схемы-дополнение блока B: полезная нагрузка предложений и применение ----- */

export const AiProposalKindSchema = z.enum(['budget', 'goal', 'reminder']);

/** Бюджет: лимит на категорию в месяце «YYYY-MM» (валидируется при «Применить»). */
export const AiBudgetProposalPayloadSchema = z.object({
  categoryId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  limit: z.number().finite().positive().max(1_000_000_000),
});
export type AiBudgetProposalPayload = z.infer<typeof AiBudgetProposalPayloadSchema>;

/** Цель накоплений. */
export const AiGoalProposalPayloadSchema = z.object({
  title: z.string().trim().min(1).max(80),
  targetAmount: z.number().finite().positive().max(1_000_000_000),
  savedAmount: z.number().finite().min(0).max(1_000_000_000).optional(),
  deadline: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Некорректная дата' })
    .optional(),
});
export type AiGoalProposalPayload = z.infer<typeof AiGoalProposalPayloadSchema>;

/** Напоминание: правило уведомлений существующего типа (ТЗ §3.6). */
export const AiReminderProposalPayloadSchema = z.object({
  notificationType: NotificationTypeSchema,
  enabled: z.boolean().optional(),
  times: z
    .array(z.string().regex(/^\d{1,2}:\d{2}$/))
    .min(1)
    .max(6)
    .optional(),
});
export type AiReminderProposalPayload = z.infer<typeof AiReminderProposalPayloadSchema>;

/** Что создано при «Применить»: id бюджета/цели или тип правила напоминания. */
export interface AiProposalApplied {
  kind: AiProposalKind;
  id: string;
}

export interface AiProposalApplyResponse {
  proposal: AiProposalDto;
  applied: AiProposalApplied;
}

/** Ответ предпросмотра разбора: обёртка над AiReviewPreviewDto. */
export type AiReviewPreviewPayload = AiReviewPreviewDto;
