// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Инсайты на правилах (ТЗ §3.5). Движок только читает данные через готовые
 * сервисы (статистика, чек-ины, бюджеты) и не меняет их. Правила живут в
 * @puls/shared; здесь — сбор данных, хранение и оценка «полезно / не полезно».
 * Оценки понижают вес неполезных типов и со временем прячут их из разбора.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, type Insight } from '@prisma/client';
import {
  DEFAULT_CHANNELS,
  DEFAULT_QUIET_HOURS,
  addDays,
  budgetExceededCandidates,
  budgetSuggestionCandidate,
  categorySpendRiseCandidates,
  countryFromTimezone,
  feedbackStatsFromRows,
  hiddenInsightTypes,
  isoWeekKey,
  lowEnergyStreakCandidates,
  moodWithSportCandidate,
  rankInsights,
  selectWeeklyInsights,
  supportResourcesFor,
  todayKeyInTimezone,
  wellbeingConcernCandidates,
  type CheckInDto,
  type InsightAction,
  type InsightCandidate,
  type InsightDto,
  type InsightFeedback,
  type InsightParams,
  type InsightSource,
  type InsightType,
  type InsightsApplyResponse,
  type InsightsFeedResponse,
  type InsightsFeedbackResponse,
  type NotificationChannel,
  type TypeFeedbackStat,
  type WeeklyReportResponse,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetsService } from '../finance/budgets.service';
import { CheckinsService } from '../checkins/checkins.service';
import { StatsService } from '../stats/stats.service';
import { NotificationDispatcher } from '../notifications/dispatcher';

/** Сколько дней самочувствия смотрим для правил. */
const WINDOW_DAYS = 14;
/** Максимум инсайтов в ленте дня. */
const FEED_LIMIT = 6;
/** Тег физической активности в чек-инах (ТЗ §3.3). */
const SPORT_TAG = 'спорт';

function toInsightDto(row: Insight): InsightDto {
  return {
    id: row.id,
    type: row.type as InsightType,
    textKey: row.textKey,
    params: (row.params ?? {}) as InsightParams,
    source: row.source as InsightSource,
    action: (row.action as unknown as InsightAction | null) ?? null,
    appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
    feedback: (row.feedback as InsightFeedback | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function actionJson(action: InsightAction | null | undefined): Prisma.InputJsonValue | undefined {
  return action ? (action as unknown as Prisma.InputJsonValue) : undefined;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10;
}

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: StatsService,
    private readonly checkins: CheckinsService,
    private readonly budgets: BudgetsService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  /** Лента инсайтов: генерирует свежие за сегодня и отдаёт последние. */
  async list(userId: string, limit = 50): Promise<InsightsFeedResponse> {
    await this.generate(userId);

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const rows = await this.prisma.insight.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const insights = rows.map(toInsightDto);
    const hasConcern = insights.some((insight) => insight.type === 'wellbeing_concern');

    return {
      insights,
      support: hasConcern ? supportResourcesFor(user.timezone) : [],
      country: countryFromTimezone(user.timezone),
    };
  }

  /** Последний инсайт для блока на главной. */
  async latest(userId: string): Promise<InsightDto | null> {
    await this.generate(userId);
    const row = await this.prisma.insight.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toInsightDto(row) : null;
  }

  /** Оценка «полезно / не полезно» — уменьшает показ неполезных типов. */
  async feedback(userId: string, id: string, feedback: InsightFeedback): Promise<InsightsFeedbackResponse> {
    const existing = await this.prisma.insight.findFirst({ where: { id, userId } });
    if (!existing) throw httpError(404, 'insight_not_found', 'Инсайт не найден');

    const updated = await this.prisma.insight.update({
      where: { id: existing.id },
      data: { feedback, feedbackAt: new Date() },
    });
    return { insight: toInsightDto(updated) };
  }

  /** «Применить» предложение — создаёт бюджет через сервис финансов. */
  async apply(userId: string, id: string): Promise<InsightsApplyResponse> {
    const existing = await this.prisma.insight.findFirst({ where: { id, userId } });
    if (!existing) throw httpError(404, 'insight_not_found', 'Инсайт не найден');

    const action = existing.action as unknown as InsightAction | null;
    if (existing.type !== 'budget_suggestion' || !action || action.kind !== 'budget') {
      throw httpError(400, 'insight_not_applicable', 'Этот инсайт нельзя применить');
    }

    const budget = await this.budgets.upsert(userId, {
      categoryId: action.categoryId,
      month: action.month,
      limit: action.monthlyLimit,
    });
    const updated = await this.prisma.insight.update({
      where: { id: existing.id },
      data: { appliedAt: new Date() },
    });

    return { insight: toInsightDto(updated), budgetId: budget.id };
  }

  /** Счётчики оценок по типу — основание понижать показ неполезных типов. */
  async feedbackStats(userId: string): Promise<TypeFeedbackStat[]> {
    const grouped = await this.prisma.insight.groupBy({
      by: ['type', 'feedback'],
      where: { userId, feedback: { not: null } },
      _count: { _all: true },
    });

    const rows = grouped
      .filter((row): row is typeof row & { feedback: string } => row.feedback !== null)
      .map((row) => ({ type: row.type, feedback: row.feedback, count: row._count._all }));
    return feedbackStatsFromRows(rows);
  }

  /** Скрытые типы инсайтов (частые «не полезно»). */
  async hiddenTypes(userId: string): Promise<InsightType[]> {
    return hiddenInsightTypes(await this.feedbackStats(userId));
  }

  /** Генерирует инсайты-правила за сегодня (идемпотентно по ключу дня). */
  async generate(userId: string, now: Date = new Date()): Promise<InsightDto[]> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const day = todayKeyInTimezone(user.timezone, now);
    const stats = await this.feedbackStats(userId);
    const candidates = rankInsights(await this.buildCandidates(userId, now), stats).slice(0, FEED_LIMIT);

    const created: InsightDto[] = [];
    for (const candidate of candidates) {
      const row = await this.prisma.insight.upsert({
        where: { userId_type_periodKey: { userId, type: candidate.type, periodKey: day } },
        create: {
          userId,
          type: candidate.type,
          textKey: candidate.textKey,
          params: candidate.params as Prisma.InputJsonValue,
          source: 'rule',
          periodKey: day,
          action: actionJson(candidate.action),
        },
        update: {},
      });
      created.push(toInsightDto(row));
    }
    return created;
  }

  /**
   * Недельный разбор: 3 инсайта и 1 предложение (ТЗ §3.5). Идемпотентно по
   * ISO-неделе; уведомление типа weekly_report уходит только при первой генерации.
   */
  async weekly(userId: string, now: Date = new Date()): Promise<{ report: WeeklyReportResponse; created: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { notificationRules: true },
    });
    const weekKey = isoWeekKey(todayKeyInTimezone(user.timezone, now));

    const existing = await this.prisma.insight.count({
      where: { userId, source: 'weekly', periodKey: weekKey },
    });
    if (existing > 0) {
      return { report: await this.weeklyReport(userId, weekKey), created: false };
    }

    const stats = await this.feedbackStats(userId);
    const selection = selectWeeklyInsights(await this.buildCandidates(userId, now), stats);
    const chosen = [...selection.insights, ...(selection.suggestion ? [selection.suggestion] : [])];

    for (const candidate of chosen) {
      await this.prisma.insight.create({
        data: {
          userId,
          type: candidate.type,
          textKey: candidate.textKey,
          params: candidate.params as Prisma.InputJsonValue,
          source: 'weekly',
          periodKey: weekKey,
          action: actionJson(candidate.action),
        },
      });
    }

    await this.notifyWeekly(user, now);
    return { report: await this.weeklyReport(userId, weekKey), created: chosen.length > 0 };
  }

  /** Последний недельный разбор (для экрана, если он уже собран). */
  async latestWeekly(userId: string): Promise<WeeklyReportResponse | null> {
    const row = await this.prisma.insight.findFirst({
      where: { userId, source: 'weekly' },
      orderBy: { createdAt: 'desc' },
    });
    if (!row?.periodKey) return null;
    return this.weeklyReport(userId, row.periodKey);
  }

  /* ----- Внутреннее ----- */

  /** Кандидаты правил по данным пользователя (только чтение чужих сервисов). */
  private async buildCandidates(userId: string, now: Date): Promise<InsightCandidate[]> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const timezone = user.timezone;
    const day = todayKeyInTimezone(timezone, now);
    const month = day.slice(0, 7);

    const [currentWeek, previousWeek, checkIns, budgets] = await Promise.all([
      this.stats.report(userId, 'week', day),
      this.stats.report(userId, 'week', addDays(day, -7)),
      this.checkins.list(userId, {
        from: new Date(now.getTime() - (WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString(),
        to: now.toISOString(),
        limit: 500,
      }),
      this.budgets.list(userId, month),
    ]);

    const energyDays = this.energyDays(checkIns, timezone, day);
    const moodDays = this.moodDays(checkIns, timezone, day);

    const candidates: InsightCandidate[] = [
      ...categorySpendRiseCandidates(currentWeek.byCategory, previousWeek.byCategory),
      ...lowEnergyStreakCandidates(energyDays),
      ...budgetExceededCandidates(
        budgets.map((budget) => ({
          categoryId: budget.categoryId,
          categoryName: budget.categoryName,
          limit: budget.limit,
          spent: budget.spent,
        })),
      ),
      ...wellbeingConcernCandidates(moodDays),
    ];

    const sport = moodWithSportCandidate(moodDays, { tag: SPORT_TAG });
    if (sport) candidates.push(sport);

    const top = currentWeek.byCategory.find((category) => category.categoryId !== null);
    if (top?.categoryId) {
      const suggestion = budgetSuggestionCandidate(
        { categoryId: top.categoryId, categoryName: top.categoryName ?? '', total: top.total },
        { month, hasBudget: budgets.some((budget) => budget.categoryId === top.categoryId) },
      );
      if (suggestion) candidates.push(suggestion);
    }

    return candidates;
  }

  /** Непрерывный ряд дней с последней известной энергией за день. */
  private energyDays(checkIns: readonly CheckInDto[], timezone: string, today: string): { day: string; energy: number | null }[] {
    const byDay = this.groupCheckIns(checkIns, timezone);
    return this.dayRange(today).map((day) => {
      const energies = (byDay.get(day) ?? []).map((checkIn) => checkIn.energy).filter((value): value is number => value !== null);
      return { day, energy: energies.length > 0 ? energies[energies.length - 1]! : null };
    });
  }

  /** Непрерывный ряд дней со средним настроением и наличием спорта. */
  private moodDays(checkIns: readonly CheckInDto[], timezone: string, today: string): { day: string; mood: number | null; tags: string[] }[] {
    const byDay = this.groupCheckIns(checkIns, timezone);
    return this.dayRange(today).map((day) => {
      const entries = byDay.get(day) ?? [];
      return {
        day,
        mood: average(entries.map((checkIn) => checkIn.mood)),
        tags: entries.some((checkIn) => checkIn.tags.includes(SPORT_TAG)) ? [SPORT_TAG] : [],
      };
    });
  }

  private groupCheckIns(checkIns: readonly CheckInDto[], timezone: string): Map<string, CheckInDto[]> {
    const byDay = new Map<string, CheckInDto[]>();
    for (const checkIn of checkIns) {
      const day = todayKeyInTimezone(timezone, new Date(checkIn.occurredAt));
      const list = byDay.get(day) ?? [];
      list.push(checkIn);
      byDay.set(day, list);
    }
    return byDay;
  }

  private dayRange(today: string): string[] {
    const days: string[] = [];
    for (let offset = WINDOW_DAYS - 1; offset >= 0; offset -= 1) days.push(addDays(today, -offset));
    return days;
  }

  private async weeklyReport(userId: string, weekKey: string): Promise<WeeklyReportResponse> {
    const rows = await this.prisma.insight.findMany({
      where: { userId, source: 'weekly', periodKey: weekKey },
      orderBy: { createdAt: 'asc' },
    });
    const insights = rows.filter((row) => row.type !== 'budget_suggestion').map(toInsightDto);
    const suggestionRow = rows.find((row) => row.type === 'budget_suggestion');
    return {
      weekKey,
      insights,
      suggestion: suggestionRow ? toInsightDto(suggestionRow) : null,
    };
  }

  private async notifyWeekly(
    user: {
      id: string;
      email: string;
      timezone: string;
      notificationsEnabled: boolean;
      notificationRules: {
        type: string;
        channel: string;
        enabled: boolean;
        quietHoursStart: number;
        quietHoursEnd: number;
      }[];
    },
    now: Date,
  ): Promise<void> {
    if (!user.notificationsEnabled) return;

    const rule = user.notificationRules.find((item) => item.type === 'weekly_report');
    // Без сохранённого правила тип включён по умолчанию (ТЗ §3.6).
    if (rule && !rule.enabled) return;

    const channel = (rule?.channel as NotificationChannel | undefined) ?? DEFAULT_CHANNELS.weekly_report;

    await this.dispatcher.dispatch(
      {
        userId: user.id,
        type: 'weekly_report',
        channel,
        times: [],
        quietHours: {
          start: rule?.quietHoursStart ?? DEFAULT_QUIET_HOURS.start,
          end: rule?.quietHoursEnd ?? DEFAULT_QUIET_HOURS.end,
        },
      },
      { now, email: user.email, timezone: user.timezone },
    );
  }
}
