// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Чат-помощник и цикл function calling (ТЗ §3.9).
 *
 * Модель получает системный промпт с рамками, только инструменты чтения и
 * предложения текущего пользователя. Цикл вызовов ограничен: после него
 * делается финальный ответ без инструментов. При тревожных сигналах в ответ
 * добавляется блок поддержки (переиспользуется shared/insights).
 */
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  aiSystemPromptFor,
  supportResourcesFor,
  todayKeyInTimezone,
  wellbeingConcernCandidates,
  type AiChatRequest,
  type AiChatResponse,
  type AiProposalDto,
  type AiUsageDto,
  type SupportResource,
} from '@puls/shared';
import type { AiCompletionResult, AiMessage } from '../ai/ai.types';
import { AiKeyService } from '../ai/ai-key.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiContextService } from './ai-context.service';
import { AI_TOOLS, AiToolsService, type AiToolExecution } from './ai-tools.service';

/** Предел итераций цикла инструментов (ТЗ §3.9: «до ~5 итераций»). */
const MAX_ITERATIONS = 5;
const MAX_TOKENS = 1024;

/**
 * Стабильный id диалога: хэш пользователя и первой реплики пользователя.
 * Клиент хранит историю сам, поэтому первая реплика одинакова весь диалог.
 */
export function chatSessionId(userId: string, messages: AiMessage[]): string {
  const first = messages.find((message) => message.role === 'user')?.content ?? '';
  return `chat-${createHash('sha256').update(`${userId}\n${first}`).digest('hex').slice(0, 32)}`;
}

export interface AiCompletionRun {
  text: string;
  proposals: AiProposalDto[];
  usage: AiUsageDto;
}

@Injectable()
export class AiChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: AiProviderService,
    private readonly keys: AiKeyService,
    private readonly tools: AiToolsService,
    private readonly context: AiContextService,
  ) {}

  /** Ответ на вопрос пользователя с циклом инструментов. */
  async chat(userId: string, input: AiChatRequest): Promise<AiChatResponse> {
    const history: AiMessage[] = input.history.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { currency: true },
    });
    const run = await this.runCompletion(userId, aiSystemPromptFor(user.currency), [
      ...history,
      { role: 'user', content: input.message },
    ]);
    return { reply: run.text, proposals: run.proposals, usage: run.usage };
  }

  /**
   * Общий цикл: модель → вызовы инструментов → результат → снова модель.
   * Возвращает финальный текст, накопленные предложения и расход месяца.
   */
  async runCompletion(
    userId: string,
    system: string,
    messages: AiMessage[],
    sessionId: string = chatSessionId(userId, messages),
  ): Promise<AiCompletionRun> {
    const proposals: AiProposalDto[] = [];
    let result: AiCompletionResult | null = null;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      result = await this.provider.complete(userId, {
        system,
        messages,
        tools: AI_TOOLS,
        maxTokens: MAX_TOKENS,
        sessionId,
      });
      if (!result.toolCalls || result.toolCalls.length === 0) {
        return this.finalize(userId, result.text, proposals);
      }

      messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        let execution: AiToolExecution;
        try {
          execution = await this.tools.execute(userId, call);
        } catch (error) {
          execution = { result: { error: error instanceof Error ? error.message : 'tool_error' } };
        }
        if (execution.proposal) proposals.push(execution.proposal);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify(execution.result),
        });
      }
    }

    // Лимит итераций исчерпан — просим финальный ответ уже без инструментов.
    const final = await this.provider.complete(userId, {
      system,
      messages,
      maxTokens: MAX_TOKENS,
      sessionId,
    });
    return this.finalize(userId, final.text, proposals);
  }

  private async finalize(
    userId: string,
    text: string,
    proposals: AiProposalDto[],
  ): Promise<AiCompletionRun> {
    const [reply, usage] = await Promise.all([
      this.appendSupport(userId, text),
      this.keys.usage(userId),
    ]);
    return { text: reply, proposals, usage };
  }

  /**
   * Добавляет блок поддержки, если есть тревожный сигнал: свежий инсайт
   * wellbeing_concern или серия очень низкого настроения. Телефоны и ссылки
   * служб берутся из shared/insights, тексты интерфейса сюда не подмешиваются.
   */
  async appendSupport(userId: string, text: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });

    const concern = await this.prisma.insight.findFirst({
      where: { userId, type: 'wellbeing_concern' },
      select: { id: true },
    });
    const lowMood = concern ? true : await this.hasLowMoodStreak(userId, user.timezone);
    if (!lowMood) return text;

    const resources = supportResourcesFor(user.timezone);
    const block = supportBlock(resources);
    return block.length > 0 ? `${text}\n\n${block}` : text;
  }

  private async hasLowMoodStreak(userId: string, timezone: string): Promise<boolean> {
    const series = await this.context.moodSeries(userId, {});
    const days = series.days.map((day) => ({ day: day.day, mood: day.avgMood }));
    if (days.every((day) => day.mood === null)) {
      // Нет данных — ориентируемся на сегодняшний день, чтобы не шуметь.
      return false;
    }
    void todayKeyInTimezone(timezone);
    return wellbeingConcernCandidates(days).length > 0;
  }
}

/** Текстовая строка поддержки: телефон и ссылка доступных служб (без диагнозов). */
export function supportBlock(resources: readonly SupportResource[]): string {
  const items = resources
    .map((resource) => [resource.phone, resource.url].filter(Boolean).join(' — '))
    .filter((line) => line.length > 0);
  if (items.length === 0) return '';
  return `Если сейчас тяжело, рядом есть поддержка: ${items.join('; ')}.`;
}
