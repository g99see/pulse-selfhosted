// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Хранение и разрешение AI-ключей (ТЗ §3.9). Два уровня: личный ключ
 * пользователя (приоритетнее) и общий ключ экземпляра, задаваемый админом.
 * Ключи лежат только зашифрованными AES-256-GCM (crypto/secret-box.ts); наружу
 * уходят последние 4 символа.
 */
import { Injectable } from '@nestjs/common';
import {
  AI_PROVIDERS,
  AiProviderSchema,
  type AiInstanceSettingsDto,
  type AiInstanceSettingsInput,
  type AiKeySetInput,
  type AiKeySource,
  type AiProvider,
  type AiStatusDto,
  type AiUsageAdminResponse,
  type AiUsageDto,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { INSTANCE_SETTINGS_ID } from '../common/instance';
import { SecretBoxService } from '../crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import { AI_DEFAULT_BASE_URL, AI_DEFAULT_MODEL } from './ai-providers';
import type { AiProviderSettings } from './ai.types';

/** Разрешённый к использованию ключ: источник, провайдер и готовые настройки. */
export interface ResolvedAiKey {
  source: AiKeySource;
  provider: AiProvider | null;
  /** Эффективная модель (сохранённая или по умолчанию провайдера). */
  model: string | null;
  /** Эффективный базовый адрес (сохранённый или по умолчанию провайдера). */
  baseUrl: string | null;
  /** Локальный провайдер (Ollama/LM Studio): данные не покидают сервер. */
  isLocal: boolean;
  /** Последние 4 символа личного ключа; для общего — null. */
  last4: string | null;
  /** Готовые настройки для адаптера; null, если ключ не настроен. */
  settings: AiProviderSettings | null;
}

/** Месяц учёта в формате «YYYY-MM» по UTC. */
export function usageMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class AiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretBoxService,
  ) {}

  /** Личный ключ приоритетнее общего; иначе AI выключен. */
  async resolve(userId: string): Promise<ResolvedAiKey> {
    const userKey = await this.prisma.userAiKey.findUnique({ where: { userId } });
    if (userKey) {
      const provider = this.parseProvider(userKey.provider);
      if (provider) {
        const apiKey = this.secrets.decrypt(userKey.apiKeyEncrypted);
        return this.build('user', provider, apiKey, userKey.baseUrl, userKey.model, userKey.apiKeyLast4);
      }
    }

    const instanceKey = await this.resolveInstanceKey();
    if (instanceKey) return instanceKey;

    return {
      source: 'none',
      provider: null,
      model: null,
      baseUrl: null,
      isLocal: false,
      last4: null,
      settings: null,
    };
  }

  /** Общий ключ экземпляра (расшифрованный) или null, если не настроен. */
  async resolveInstanceKey(): Promise<ResolvedAiKey | null> {
    const instance = await this.prisma.instanceSettings.findUnique({ where: { id: INSTANCE_SETTINGS_ID } });
    if (!instance?.aiProvider || instance.aiApiKeyEncrypted === null) return null;
    const provider = this.parseProvider(instance.aiProvider);
    if (!provider) return null;
    const apiKey = this.secrets.decrypt(instance.aiApiKeyEncrypted);
    return this.build('instance', provider, apiKey, instance.aiBaseUrl, instance.aiModel, null);
  }

  /** Состояние AI для пользователя: включён ли, чей ключ и расход за месяц. */
  async status(userId: string, now: Date = new Date()): Promise<AiStatusDto> {
    const resolved = await this.resolve(userId);
    const usage = await this.usage(userId, now);
    return {
      enabled: resolved.source !== 'none',
      source: resolved.source,
      provider: resolved.provider,
      model: resolved.model,
      last4: resolved.source === 'user' ? resolved.last4 : null,
      baseUrl: resolved.baseUrl,
      usage,
    };
  }

  /** Текущий расход за месяц и лимит (для общего ключа). */
  async usage(userId: string, now: Date = new Date()): Promise<AiUsageDto> {
    const month = usageMonth(now);
    const [row, instance] = await Promise.all([
      this.prisma.aiUsage.findUnique({ where: { userId_month: { userId, month } } }),
      this.prisma.instanceSettings.findUnique({ where: { id: INSTANCE_SETTINGS_ID } }),
    ]);
    return {
      month,
      tokensIn: row?.tokensIn ?? 0,
      tokensOut: row?.tokensOut ?? 0,
      costUsd: row ? Number(row.costUsd) : 0,
      limitTokens: instance?.aiMonthlyTokenLimit ?? null,
    };
  }

  /** Сохраняет личный ключ пользователя (ключ шифруется). */
  async setUserKey(userId: string, input: AiKeySetInput): Promise<void> {
    const provider = this.parseProvider(input.provider);
    if (!provider) throw httpError(400, 'validation_error', 'Неизвестный AI-провайдер');
    const apiKey = input.apiKey ?? '';
    const encrypted = this.encrypt(apiKey);
    const last4 = apiKey.length >= 4 ? apiKey.slice(-4) : null;

    await this.prisma.userAiKey.upsert({
      where: { userId },
      create: {
        userId,
        provider,
        apiKeyEncrypted: encrypted,
        apiKeyLast4: last4,
        baseUrl: input.baseUrl ?? null,
        model: input.model ?? null,
      },
      update: {
        provider,
        apiKeyEncrypted: encrypted,
        apiKeyLast4: last4,
        baseUrl: input.baseUrl ?? null,
        model: input.model ?? null,
      },
    });
  }

  /** Удаляет личный ключ: пользователь возвращается к общему ключу экземпляра. */
  async clearUserKey(userId: string): Promise<void> {
    await this.prisma.userAiKey.deleteMany({ where: { userId } });
  }

  /** Настройки AI экземпляра для админки (без самого ключа). */
  async getInstanceSettings(): Promise<AiInstanceSettingsDto> {
    const instance = await this.prisma.instanceSettings.findUnique({ where: { id: INSTANCE_SETTINGS_ID } });
    const provider = this.parseProvider(instance?.aiProvider);
    return {
      provider,
      last4: instance?.aiApiKeyLast4 ?? null,
      baseUrl: instance?.aiBaseUrl ?? null,
      model: instance?.aiModel ?? null,
      monthlyTokenLimit: instance?.aiMonthlyTokenLimit ?? null,
    };
  }

  /**
   * Частично обновляет настройки экземпляра. Пустое или отсутствующее поле не
   * меняется; `null` очищает. Пустой apiKey оставляет прежний ключ.
   */
  async setInstanceSettings(input: AiInstanceSettingsInput): Promise<void> {
    const current = await this.prisma.instanceSettings.findUnique({ where: { id: INSTANCE_SETTINGS_ID } });

    let encrypted = current?.aiApiKeyEncrypted ?? null;
    let last4 = current?.aiApiKeyLast4 ?? null;
    if (typeof input.apiKey === 'string' && input.apiKey.length > 0) {
      encrypted = this.encrypt(input.apiKey);
      last4 = input.apiKey.slice(-4);
    }

    const provider = input.provider === undefined ? (current?.aiProvider ?? null) : input.provider;
    const baseUrl = input.baseUrl === undefined ? (current?.aiBaseUrl ?? null) : input.baseUrl;
    const model = input.model === undefined ? (current?.aiModel ?? null) : input.model;
    const monthlyTokenLimit =
      input.monthlyTokenLimit === undefined ? (current?.aiMonthlyTokenLimit ?? null) : input.monthlyTokenLimit;

    await this.prisma.instanceSettings.upsert({
      where: { id: INSTANCE_SETTINGS_ID },
      create: { id: INSTANCE_SETTINGS_ID, aiProvider: provider, aiApiKeyEncrypted: encrypted, aiApiKeyLast4: last4, aiBaseUrl: baseUrl, aiModel: model, aiMonthlyTokenLimit: monthlyTokenLimit },
      update: { aiProvider: provider, aiApiKeyEncrypted: encrypted, aiApiKeyLast4: last4, aiBaseUrl: baseUrl, aiModel: model, aiMonthlyTokenLimit: monthlyTokenLimit },
    });
  }

  /** Накапливает расход токенов за месяц (upsert по user_id + month). */
  async recordUsage(userId: string, tokensIn: number, tokensOut: number, costUsd: number, now: Date = new Date()): Promise<void> {
    const month = usageMonth(now);
    await this.prisma.aiUsage.upsert({
      where: { userId_month: { userId, month } },
      create: { userId, month, tokensIn, tokensOut, costUsd },
      update: {
        tokensIn: { increment: tokensIn },
        tokensOut: { increment: tokensOut },
        costUsd: { increment: costUsd },
      },
    });
  }

  /** Расход всех пользователей за месяц для админки. */
  async adminUsage(month: string): Promise<AiUsageAdminResponse> {
    const rows = await this.prisma.aiUsage.findMany({
      where: { month },
      include: { user: { select: { nickname: true } } },
      orderBy: [{ tokensIn: 'desc' }, { tokensOut: 'desc' }],
    });
    return {
      month,
      rows: rows.map((row) => ({
        userId: row.userId,
        nickname: row.user.nickname,
        month: row.month,
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        costUsd: Number(row.costUsd),
      })),
    };
  }

  private build(
    source: AiKeySource,
    provider: AiProvider,
    apiKey: string,
    baseUrl: string | null,
    model: string | null,
    last4: string | null,
  ): ResolvedAiKey {
    const effectiveModel = model || AI_DEFAULT_MODEL[provider];
    const effectiveBaseUrl = baseUrl || AI_DEFAULT_BASE_URL[provider] || null;
    return {
      source,
      provider,
      model: effectiveModel,
      baseUrl: effectiveBaseUrl,
      isLocal: provider === 'openai_compatible',
      last4,
      settings: { provider, apiKey, baseUrl, model: effectiveModel },
    };
  }

  private parseProvider(value: string | null | undefined): AiProvider | null {
    const parsed = AiProviderSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  private encrypt(plaintext: string): string {
    if (!this.secrets.available) {
      throw httpError(
        503,
        'ai_key_storage_unavailable',
        'Хранение AI-ключей недоступно: не задан APP_ENCRYPTION_KEY',
      );
    }
    return this.secrets.encrypt(plaintext);
  }
}

/** Список провайдеров (переэкспорт для контроллеров, без магических строк). */
export const AI_PROVIDER_IDS: readonly AiProvider[] = AI_PROVIDERS;
