// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable, Logger } from '@nestjs/common';
import type { CheckIn } from '@prisma/client';
import {
  DEFAULT_CHECKIN_SCHEDULE,
  checkinGoalProgress,
  dayKeyInTimezone,
  isMorningForSleep,
  weekStartKey,
  zonedDayBounds,
  addDays,
  type CheckinGoalDto,
  dayBoundsInTimeZone,
  isWithinBackdateWindow,
  type CheckInDto,
  type CheckInFilter,
  type CheckInInput,
  type CheckInScheduleDto,
  type CheckInSlot,
  type CheckInUpdateInput,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementsService } from '../achievements/achievements.service';
import { StatsService } from '../stats/stats.service';
import { DomainEvents } from '../api-access/domain-events';

/** Допуск на расхождение часов клиента и сервера, мс. */
const FUTURE_TOLERANCE_MS = 60_000;

/**
 * Проверяет момент чек-ина: не в будущем и не старше 24 часов (ТЗ §3.3).
 * Без значения — текущее время.
 */
export function resolveOccurredAt(value: string | undefined, now: Date): Date {
  if (!value) return now;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw httpError(400, 'validation_error', 'Некорректная дата чек-ина');
  }
  if (parsed.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw httpError(400, 'validation_error', 'Нельзя заполнить чек-ин в будущем');
  }
  if (!isWithinBackdateWindow(parsed, now)) {
    throw httpError(
      400,
      'checkin_window_expired',
      'Заполнить задним числом можно в течение 24 часов',
    );
  }
  return parsed;
}

export function toCheckInDto(checkIn: CheckIn): CheckInDto {
  return {
    id: checkIn.id,
    mood: checkIn.mood,
    energy: checkIn.energy,
    stress: checkIn.stress,
    sleepHours: checkIn.sleepHours,
    water: checkIn.water,
    steps: checkIn.steps,
    tags: checkIn.tags,
    note: checkIn.note,
    daySummary: checkIn.daySummary,
    slot: (checkIn.slot as CheckInSlot | null) ?? null,
    occurredAt: checkIn.occurredAt.toISOString(),
    createdAt: checkIn.createdAt.toISOString(),
  };
}

/** Чек-ины самочувствия (ТЗ §3.3): ответ настроением, расширенный чек-ин, расписание. */
@Injectable()
export class CheckinsService {
  private readonly logger = new Logger(CheckinsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly achievements: AchievementsService,
    private readonly stats: StatsService,
  ) {}

  /** Часовой пояс пользователя: им определяются сутки чек-ина (ТЗ §3.3). */
  private async timezoneOf(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return user?.timezone ?? 'UTC';
  }

  /**
   * Пересчитывает дневной кеш DailyStat за дни, которых касается изменение
   * чек-ина (ТЗ §3.4). День записи определяется occurredAt, поэтому правка
   * момента может перенести чек-ин между сутками — затрагиваются оба дня.
   * Сбой пересчёта не должен ломать саму запись чек-ина.
   */
  private async recomputeDays(
    userId: string,
    timezone: string,
    instants: readonly Date[],
  ): Promise<void> {
    const days = new Set(instants.map((instant) => dayKeyInTimezone(instant, timezone)));
    for (const day of days) {
      try {
        await this.stats.recomputeRange(userId, timezone, day, day);
      } catch (error) {
        this.logger.warn(`DailyStat за ${day} не пересчитан: ${String(error)}`);
      }
    }
  }

  async create(userId: string, input: CheckInInput): Promise<CheckInDto> {
    const now = new Date();
    const occurredAt = resolveOccurredAt(input.occurredAt, now);
    // Вопрос о сне — только утром (04:00–12:00 по локальному времени пользователя).
    // Вне окна присланное поле сна тихо игнорируется (не 500), данные за день не ломаются.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const morning = isMorningForSleep(occurredAt, user?.timezone ?? 'UTC');

    const created = await this.prisma.checkIn.create({
      data: {
        userId,
        mood: input.mood,
        energy: input.energy ?? null,
        stress: input.stress ?? null,
        sleepHours: morning ? (input.sleepHours ?? null) : null,
        water: input.water ?? null,
        steps: input.steps ?? null,
        tags: input.tags ?? [],
        note: input.note ?? null,
        daySummary: input.daySummary ?? null,
        slot: input.slot ?? null,
        occurredAt,
      },
    });

    // Ленивая проверка достижений сразу после записи (ТЗ §4): сбой не ломает чек-ин.
    await this.achievements.onEvent(userId, 'checkin');

    // Дневной кеш статистики сразу относит запись к её дню (ТЗ §3.4).
    await this.recomputeDays(userId, user?.timezone ?? 'UTC', [created.occurredAt]);

    // Событие для вебхуков (ТЗ §4): одна строка, сигнатуру create не меняет.
    DomainEvents.emit('checkin.created', userId, {
      id: created.id,
      mood: created.mood,
      occurredAt: created.occurredAt.toISOString(),
    });

    return toCheckInDto(created);
  }

  /** Цель «N чек-инов в неделю» и прогресс по текущей неделе (пн–вс, пояс пользователя). */
  async goal(userId: string, now: Date = new Date()): Promise<CheckinGoalDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true, checkinWeeklyGoal: true },
    });
    const weekStart = weekStartKey(dayBoundsInTimeZone(now, user.timezone).dayKey);
    const count = await this.prisma.checkIn.count({
      where: {
        userId,
        occurredAt: {
          gte: zonedDayBounds(weekStart, user.timezone).start,
          lt: zonedDayBounds(addDays(weekStart, 7), user.timezone).start,
        },
      },
    });
    return checkinGoalProgress(user.checkinWeeklyGoal, count, weekStart);
  }

  async setGoal(userId: string, perWeek: number | null): Promise<CheckinGoalDto> {
    await this.prisma.user.update({ where: { id: userId }, data: { checkinWeeklyGoal: perWeek } });
    return this.goal(userId);
  }

  async list(userId: string, filter: CheckInFilter): Promise<CheckInDto[]> {
    const where: import('@prisma/client').Prisma.CheckInWhereInput = { userId };
    if (filter.from || filter.to) {
      where.occurredAt = {
        ...(filter.from ? { gte: new Date(filter.from) } : {}),
        ...(filter.to ? { lte: new Date(filter.to) } : {}),
      };
    }

    const checkIns = await this.prisma.checkIn.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: filter.limit,
    });

    return checkIns.map(toCheckInDto);
  }

  /** Чек-ины текущего дня по часовому поясу пользователя (для карточки на главной). */
  async today(userId: string): Promise<{ dayKey: string; checkIns: CheckInDto[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const { start, end, dayKey } = dayBoundsInTimeZone(new Date(), user?.timezone ?? 'UTC');

    const checkIns = await this.prisma.checkIn.findMany({
      where: { userId, occurredAt: { gte: start, lt: end } },
      orderBy: { occurredAt: 'desc' },
    });

    return { dayKey, checkIns: checkIns.map(toCheckInDto) };
  }

  async get(userId: string, id: string): Promise<CheckInDto> {
    const checkIn = await this.prisma.checkIn.findFirst({ where: { id, userId } });
    if (!checkIn) {
      throw httpError(404, 'checkin_not_found', 'Чек-ин не найден');
    }
    return toCheckInDto(checkIn);
  }

  async update(userId: string, id: string, input: CheckInUpdateInput): Promise<CheckInDto> {
    const existing = await this.get(userId, id);

    const data: import('@prisma/client').Prisma.CheckInUpdateInput = {};
    if (input.mood !== undefined) data.mood = input.mood;
    if (input.energy !== undefined) data.energy = input.energy;
    if (input.stress !== undefined) data.stress = input.stress;
    if (input.sleepHours !== undefined) {
      // Правку сна принимаем только для утреннего чек-ина; вне окна — игнорируем.
      const moment =
        input.occurredAt !== undefined
          ? resolveOccurredAt(input.occurredAt, new Date())
          : new Date(existing.occurredAt);
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });
      data.sleepHours = isMorningForSleep(moment, user?.timezone ?? 'UTC')
        ? input.sleepHours
        : null;
    }
    if (input.water !== undefined) data.water = input.water;
    if (input.steps !== undefined) data.steps = input.steps;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.note !== undefined) data.note = input.note;
    if (input.daySummary !== undefined) data.daySummary = input.daySummary;
    if (input.slot !== undefined) data.slot = input.slot;
    if (input.occurredAt !== undefined)
      data.occurredAt = resolveOccurredAt(input.occurredAt, new Date());

    const updated = await this.prisma.checkIn.update({ where: { id }, data });
    // Правка могла перенести чек-ин в другие сутки — пересчитываем оба дня.
    await this.recomputeDays(userId, await this.timezoneOf(userId), [
      new Date(existing.occurredAt),
      updated.occurredAt,
    ]);
    return toCheckInDto(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.get(userId, id);
    await this.prisma.checkIn.delete({ where: { id } });
    await this.recomputeDays(userId, await this.timezoneOf(userId), [
      new Date(existing.occurredAt),
    ]);
  }

  /** Расписание напоминаний (ТЗ §3.3): только настройка и хранение. */
  async getSchedule(userId: string): Promise<CheckInScheduleDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { checkinTimesPerDay: true, checkinTimes: true },
    });
    if (!user || user.checkinTimes.length === 0) {
      return { ...DEFAULT_CHECKIN_SCHEDULE, times: [...DEFAULT_CHECKIN_SCHEDULE.times] };
    }
    return { timesPerDay: user.checkinTimesPerDay, times: user.checkinTimes };
  }

  async setSchedule(userId: string, schedule: CheckInScheduleDto): Promise<CheckInScheduleDto> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { checkinTimesPerDay: schedule.timesPerDay, checkinTimes: schedule.times },
    });
    return { timesPerDay: schedule.timesPerDay, times: [...schedule.times] };
  }
}
