// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Разборы недели и месяца (ТЗ §3.9).
 *
 * Предпросмотр показывает, какие именно данные уйдут провайдеру, и считает
 * `isLocal` по ключу. Заметки и имя подмешиваются только при отдельных флагах
 * includeNotes/includeName. Сам разбор идёт тем же циклом инструментов, что и
 * чат, поэтому может предложить бюджет/цель/напоминание (pending).
 */
import { Injectable } from '@nestjs/common';
import {
  AI_SYSTEM_PROMPT,
  periodRangeFromDay,
  todayKeyInTimezone,
  type AiReviewPreviewResponse,
  type AiReviewRequest,
  type AiReviewResponse,
} from '@puls/shared';
import { AiKeyService } from '../ai/ai-key.service';
import { BudgetsService } from '../finance/budgets.service';
import { GoalsService } from '../goals/goals.service';
import { PrismaService } from '../prisma/prisma.service';
import { StatsService } from '../stats/stats.service';
import { AiChatService } from './ai-chat.service';
import { AiContextService } from './ai-context.service';

export interface ReviewData {
  period: 'week' | 'month';
  from: string;
  to: string;
  currency: string;
  spent: number;
  earned: number;
  avgMood: number | null;
  checkins: number;
  byCategory: { name: string; total: number }[];
  budgets: { name: string; limit: number; spent: number }[];
  goals: { title: string; saved: number; target: number; percent: number }[];
  streak: number;
  /** Заметки — только при includeNotes. */
  notes?: string[];
  /** Имя/никнейм — только при includeName. */
  name?: string;
}

/** Текстовое представление данных разбора — ровно то, что уйдёт провайдеру. */
export function renderReviewPayload(data: ReviewData): string {
  const lines: string[] = [];
  lines.push(`Период: ${data.from} — ${data.to} (${data.period === 'week' ? 'неделя' : 'месяц'})`);
  if (data.name) lines.push(`Пользователь: ${data.name}`);
  lines.push(`Расходы: ${data.spent} ${data.currency}`);
  lines.push(`Доходы: ${data.earned} ${data.currency}`);
  lines.push(`Среднее настроение: ${data.avgMood === null ? 'нет данных' : data.avgMood}`);
  lines.push(`Чек-инов: ${data.checkins}`);
  lines.push(`Стрик чек-инов: ${data.streak}`);

  if (data.byCategory.length > 0) {
    lines.push('Расходы по категориям:');
    for (const category of data.byCategory) lines.push(`- ${category.name}: ${category.total}`);
  }
  if (data.budgets.length > 0) {
    lines.push('Бюджеты:');
    for (const budget of data.budgets) lines.push(`- ${budget.name}: ${budget.spent} из ${budget.limit}`);
  }
  if (data.goals.length > 0) {
    lines.push('Цели:');
    for (const goal of data.goals) lines.push(`- ${goal.title}: ${goal.saved} из ${goal.target} (${goal.percent}%)`);
  }
  if (data.notes && data.notes.length > 0) {
    lines.push('Заметки чек-инов:');
    for (const note of data.notes) lines.push(`- ${note}`);
  }
  return lines.join('\n');
}

const REVIEW_INSTRUCTION =
  ' Сделай краткий разбор периода: три наблюдения и одно предложение на следующий период. ' +
  'Без медицинских диагнозов и советов по конкретным инвестициям.';

@Injectable()
export class AiReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: AiKeyService,
    private readonly stats: StatsService,
    private readonly budgets: BudgetsService,
    private readonly goals: GoalsService,
    private readonly context: AiContextService,
    private readonly chat: AiChatService,
  ) {}

  /** Что уйдёт провайдеру: текст данных, провайдер, локальность и флаги. */
  async preview(userId: string, input: AiReviewRequest): Promise<AiReviewPreviewResponse> {
    const resolved = await this.keys.resolve(userId);
    const data = await this.gather(userId, input);
    return {
      preview: {
        period: input.period,
        provider: resolved.provider,
        isLocal: resolved.isLocal,
        payloadText: renderReviewPayload(data),
        includesNotes: Boolean(input.includeNotes),
        includesName: Boolean(input.includeName),
      },
    };
  }

  /** Разбор периода: текст модели и предложения (pending) как в чате. */
  async review(userId: string, input: AiReviewRequest): Promise<AiReviewResponse> {
    const data = await this.gather(userId, input);
    const payloadText = renderReviewPayload(data);
    const content =
      `Данные за период:\n${payloadText}\n\nСделай разбор: три наблюдения и одно предложение.`;

    const run = await this.chat.runCompletion(userId, `${AI_SYSTEM_PROMPT}${REVIEW_INSTRUCTION}`, [
      { role: 'user', content },
    ]);
    return { review: run.text, proposals: run.proposals, usage: run.usage };
  }

  private async gather(userId: string, input: AiReviewRequest): Promise<ReviewData> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true, nickname: true, currency: true },
    });
    const today = todayKeyInTimezone(user.timezone);
    const range = periodRangeFromDay(input.period, today);

    const [report, budgets, goals, streak] = await Promise.all([
      this.stats.report(userId, input.period, today),
      this.budgets.list(userId, today.slice(0, 7)),
      this.goals.list(userId),
      this.context.streak(userId),
    ]);

    const data: ReviewData = {
      period: input.period,
      from: range.from,
      to: range.to,
      currency: report.currency,
      spent: report.spent,
      earned: report.earned,
      avgMood: report.avgMood,
      checkins: report.checkins,
      byCategory: report.byCategory.map((category) => ({
        name: category.categoryName ?? 'Без категории',
        total: category.total,
      })),
      budgets: budgets.map((budget) => ({
        name: budget.categoryName,
        limit: budget.limit,
        spent: budget.spent,
      })),
      goals: goals.map((goal) => ({
        title: goal.title,
        saved: goal.savedAmount,
        target: goal.targetAmount,
        percent: goal.percent,
      })),
      streak: Math.max(streak.current, streak.longest),
    };

    if (input.includeName) data.name = user.nickname;

    if (input.includeNotes) {
      const checkIns = await this.prisma.checkIn.findMany({
        where: {
          userId,
          note: { not: null },
          occurredAt: {
            gte: new Date(`${range.from}T00:00:00.000Z`),
            lt: new Date(`${range.to}T23:59:59.999Z`),
          },
        },
        select: { note: true },
        orderBy: { occurredAt: 'asc' },
        take: 50,
      });
      data.notes = checkIns
        .map((checkIn) => checkIn.note)
        .filter((note): note is string => note !== null && note.trim() !== '');
    }

    return data;
  }
}
