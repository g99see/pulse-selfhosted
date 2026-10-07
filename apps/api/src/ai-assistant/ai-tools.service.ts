// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Инструменты AI-помощника (ТЗ §3.9): только чтение и только данные текущего
 * пользователя. `userId` всегда приходит из сессии аргументом `execute` и
 * никогда не берётся из аргументов, которые предложила модель. Инструменты
 * предложения ничего не сохраняют в бюджеты/цели — только создают AiProposal
 * (pending), который применяет пользователь кнопкой «Применить».
 */
import { Injectable } from '@nestjs/common';
import { NOTIFICATION_TYPES } from '@puls/shared';
import type { AiTool, AiToolCall } from '../ai/ai.types';
import type { AiProposalDto } from '@puls/shared';
import { AiContextService } from './ai-context.service';
import { AiProposalsService } from './ai-proposals.service';

export const AI_TOOL_NAMES = {
  spendingSummary: 'get_spending_summary',
  transactions: 'list_transactions',
  mood: 'get_mood',
  goals: 'get_goals',
  budgets: 'get_budgets',
  achievements: 'get_achievements',
  proposeBudget: 'propose_budget',
  proposeGoal: 'propose_goal',
  proposeReminder: 'propose_reminder',
} as const;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const num = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export interface AiToolExecution {
  /** Результат инструмента, который уходит обратно модели (JSON-строкой). */
  result: unknown;
  /** Созданное предложение, если инструмент его породил. */
  proposal?: AiProposalDto;
}

/** Описания инструментов для function calling (JSON-схемы, только чтение). */
export const AI_TOOLS: AiTool[] = [
  {
    name: AI_TOOL_NAMES.spendingSummary,
    description: 'Сводка расходов по категориям за период (по умолчанию — текущий месяц).',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Начало периода, YYYY-MM-DD' },
        to: { type: 'string', description: 'Конец периода, YYYY-MM-DD' },
        categoryId: { type: 'string', description: 'Ограничить одной категорией' },
      },
    },
  },
  {
    name: AI_TOOL_NAMES.transactions,
    description: 'Последние транзакции пользователя (без заметок и комментариев).',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Сколько строк, 1–50 (по умолчанию 20)' },
        from: { type: 'string', description: 'Начало периода, YYYY-MM-DD' },
        to: { type: 'string', description: 'Конец периода, YYYY-MM-DD' },
        type: { type: 'string', enum: ['expense', 'income'], description: 'Вид операции' },
      },
    },
  },
  {
    name: AI_TOOL_NAMES.mood,
    description: 'Настроение и энергия по дням за период (без заметок).',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Начало периода, YYYY-MM-DD' },
        to: { type: 'string', description: 'Конец периода, YYYY-MM-DD' },
      },
    },
  },
  {
    name: AI_TOOL_NAMES.goals,
    description: 'Цели накоплений с прогрессом и сроком.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: AI_TOOL_NAMES.budgets,
    description: 'Бюджеты месяца по категориям: лимит и потрачено.',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Месяц «YYYY-MM», по умолчанию текущий' },
      },
    },
  },
  {
    name: AI_TOOL_NAMES.achievements,
    description: 'Стрик чек-инов и полученные достижения.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: AI_TOOL_NAMES.proposeBudget,
    description:
      'Предложить бюджет на категорию. Сам ничего не сохраняет: пользователь применит кнопкой.',
    parameters: {
      type: 'object',
      properties: {
        categoryId: { type: 'string', description: 'id категории из сводки расходов' },
        month: { type: 'string', description: 'Месяц «YYYY-MM»' },
        limit: { type: 'number', description: 'Месячный лимит' },
        summary: { type: 'string', description: 'Короткое описание для кнопки' },
      },
      required: ['categoryId', 'month', 'limit'],
    },
  },
  {
    name: AI_TOOL_NAMES.proposeGoal,
    description: 'Предложить цель накоплений. Сам ничего не сохраняет.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        targetAmount: { type: 'number' },
        savedAmount: { type: 'number' },
        deadline: { type: 'string', description: 'YYYY-MM-DD' },
        summary: { type: 'string' },
      },
      required: ['title', 'targetAmount'],
    },
  },
  {
    name: AI_TOOL_NAMES.proposeReminder,
    description: 'Предложить напоминание (правило уведомлений). Сам ничего не сохраняет.',
    parameters: {
      type: 'object',
      properties: {
        notificationType: {
          type: 'string',
          enum: [...NOTIFICATION_TYPES],
          description: 'Тип уведомления',
        },
        times: { type: 'array', items: { type: 'string' }, description: 'Времена «HH:MM»' },
        enabled: { type: 'boolean' },
        summary: { type: 'string' },
      },
      required: ['notificationType'],
    },
  },
];

@Injectable()
export class AiToolsService {
  constructor(
    private readonly context: AiContextService,
    private readonly proposals: AiProposalsService,
  ) {}

  /**
   * Выполняет вызов инструмента от имени сессионного пользователя. Любая
   * пользовательская привязка идёт через `userId`; аргументы модели не могут
   * выбрать другого пользователя.
   */
  async execute(userId: string, call: AiToolCall): Promise<AiToolExecution> {
    const args = call.arguments ?? {};

    switch (call.name) {
      case AI_TOOL_NAMES.spendingSummary:
        return {
          result: await this.context.spendingSummary(userId, {
            from: str(args.from),
            to: str(args.to),
            categoryId: str(args.categoryId),
          }),
        };

      case AI_TOOL_NAMES.transactions:
        return {
          result: await this.context.listTransactions(userId, {
            limit: num(args.limit),
            from: str(args.from),
            to: str(args.to),
            type: str(args.type),
          }),
        };

      case AI_TOOL_NAMES.mood:
        return {
          result: await this.context.moodSeries(userId, { from: str(args.from), to: str(args.to) }),
        };

      case AI_TOOL_NAMES.goals:
        return { result: await this.context.goals(userId) };

      case AI_TOOL_NAMES.budgets:
        return { result: await this.context.budgets(userId, str(args.month)) };

      case AI_TOOL_NAMES.achievements:
        return { result: await this.context.achievements(userId) };

      case AI_TOOL_NAMES.proposeBudget:
        return this.proposeBudget(userId, args);

      case AI_TOOL_NAMES.proposeGoal:
        return this.proposeGoal(userId, args);

      case AI_TOOL_NAMES.proposeReminder:
        return this.proposeReminder(userId, args);

      default:
        return { result: { error: `unknown_tool: ${call.name}` } };
    }
  }

  private async proposeBudget(
    userId: string,
    args: Record<string, unknown>,
  ): Promise<AiToolExecution> {
    const payload = {
      categoryId: str(args.categoryId) ?? '',
      month: str(args.month) ?? '',
      limit: num(args.limit) ?? 0,
    };
    const summary =
      str(args.summary) ??
      `Бюджет ${payload.limit} на ${payload.month} по категории ${payload.categoryId}`;
    const proposal = await this.proposals.create({ userId, kind: 'budget', summary, payload });
    return {
      result: { proposalId: proposal.id, kind: proposal.kind, status: proposal.status },
      proposal,
    };
  }

  private async proposeGoal(
    userId: string,
    args: Record<string, unknown>,
  ): Promise<AiToolExecution> {
    const payload: Record<string, unknown> = {
      title: str(args.title) ?? '',
      targetAmount: num(args.targetAmount) ?? 0,
    };
    if (num(args.savedAmount) !== undefined) payload.savedAmount = num(args.savedAmount);
    if (str(args.deadline)) payload.deadline = str(args.deadline);

    const summary = str(args.summary) ?? `Цель «${payload.title}» на ${payload.targetAmount}`;
    const proposal = await this.proposals.create({ userId, kind: 'goal', summary, payload });
    return {
      result: { proposalId: proposal.id, kind: proposal.kind, status: proposal.status },
      proposal,
    };
  }

  private async proposeReminder(
    userId: string,
    args: Record<string, unknown>,
  ): Promise<AiToolExecution> {
    const payload: Record<string, unknown> = {
      notificationType: str(args.notificationType) ?? '',
    };
    if (Array.isArray(args.times)) payload.times = args.times.map((value) => String(value));
    if (typeof args.enabled === 'boolean') payload.enabled = args.enabled;

    const summary = str(args.summary) ?? `Напоминание «${payload.notificationType}»`;
    const proposal = await this.proposals.create({ userId, kind: 'reminder', summary, payload });
    return {
      result: { proposalId: proposal.id, kind: proposal.kind, status: proposal.status },
      proposal,
    };
  }
}
