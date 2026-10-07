// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import type { Habit, HabitLog } from '@prisma/client';
import {
  habitDateToDayKey,
  habitDayKey,
  habitDayToDate,
  habitStatsFromDayKeys,
  type HabitCadence,
  type HabitCreateInput,
  type HabitDto,
  type HabitLogDto,
  type HabitLogInput,
  type HabitLogResult,
  type HabitStatsDto,
  type HabitStatsItemDto,
  type HabitStatsResponse,
  type HabitTodayItemDto,
  type HabitTodayResponse,
  type HabitUpdateInput,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { InternalEvents } from '../common/internal-events';
import { PrismaService } from '../prisma/prisma.service';

/** Календарная дата YYYY-MM-DD без времени. */
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toHabitDto(habit: Habit): HabitDto {
  return {
    id: habit.id,
    name: habit.name,
    icon: habit.icon,
    cadence: (habit.goalType as HabitCadence) ?? 'daily',
    perWeek: habit.perWeek,
    archived: habit.archived,
    createdAt: habit.createdAt.toISOString(),
  };
}

function toLogDto(log: HabitLog): HabitLogDto {
  return {
    id: log.id,
    habitId: log.habitId,
    date: habitDateToDayKey(log.date),
    done: log.done,
    createdAt: log.createdAt.toISOString(),
  };
}

/** Приводит входную дату отметки к календарному дню YYYY-MM-DD. */
export function resolveHabitDayKey(value: string | undefined, timeZone: string, now: Date): string {
  if (!value) return habitDayKey(now, timeZone);
  if (DAY_KEY_RE.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw httpError(400, 'validation_error', 'Некорректная дата отметки');
  }
  return habitDayKey(parsed, timeZone);
}

/**
 * Трекер привычек (ТЗ §4, P2): CRUD привычек и идемпотентные отметки по дням.
 * Серия и проценты считаются чистыми функциями из @puls/shared.
 */
@Injectable()
export class HabitsService {
  constructor(private readonly prisma: PrismaService) {}

  private async timeZone(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return user?.timezone ?? 'UTC';
  }

  async list(userId: string): Promise<HabitDto[]> {
    const habits = await this.prisma.habit.findMany({
      where: { userId },
      orderBy: [{ archived: 'asc' }, { createdAt: 'asc' }],
    });
    return habits.map(toHabitDto);
  }

  /** Привычка пользователя либо 404 (чужая привычка не видна). */
  async resolveOwned(userId: string, id: string): Promise<Habit> {
    const habit = await this.prisma.habit.findFirst({ where: { id, userId } });
    if (!habit) {
      throw httpError(404, 'habit_not_found', 'Привычка не найдена');
    }
    return habit;
  }

  async get(userId: string, id: string): Promise<HabitDto> {
    return toHabitDto(await this.resolveOwned(userId, id));
  }

  async create(userId: string, input: HabitCreateInput): Promise<HabitDto> {
    const habit = await this.prisma.habit.create({
      data: {
        userId,
        name: input.name,
        icon: input.icon,
        goalType: input.cadence,
        perWeek: input.cadence === 'daily' ? 1 : input.perWeek,
      },
    });
    InternalEvents.emit('achievement.check', { userId, event: 'habit' });
    return toHabitDto(habit);
  }

  async update(userId: string, id: string, input: HabitUpdateInput): Promise<HabitDto> {
    await this.resolveOwned(userId, id);
    const cadence = input.cadence;

    const habit = await this.prisma.habit.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(cadence !== undefined ? { goalType: cadence } : {}),
        ...(input.perWeek !== undefined ? { perWeek: input.perWeek } : {}),
        ...(input.archived !== undefined ? { archived: input.archived } : {}),
      },
    });

    // У ежедневной привычки цель в неделю не задаётся.
    if (habit.goalType === 'daily' && habit.perWeek !== 1) {
      const normalized = await this.prisma.habit.update({
        where: { id },
        data: { perWeek: 1 },
      });
      return toHabitDto(normalized);
    }
    return toHabitDto(habit);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.habit.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      throw httpError(404, 'habit_not_found', 'Привычка не найдена');
    }
  }

  /** Отметка за дату (идемпотентно): повторный вызов не создаёт дубликат. */
  async mark(userId: string, id: string, input: HabitLogInput): Promise<HabitLogResult> {
    const habit = await this.resolveOwned(userId, id);
    const timeZone = await this.timeZone(userId);
    const todayKey = habitDayKey(new Date(), timeZone);
    const dayKey = resolveHabitDayKey(input.date, timeZone, new Date());

    if (dayKey > todayKey) {
      throw httpError(400, 'habit_future_date', 'Нельзя отметить привычку в будущем');
    }

    const date = habitDayToDate(dayKey);
    const log = await this.prisma.habitLog.upsert({
      where: { habitId_date: { habitId: habit.id, date } },
      create: { habitId: habit.id, userId, date, done: input.done },
      update: { done: input.done },
    });

    InternalEvents.emit('achievement.check', { userId, event: 'habit' });
    const stats = await this.statsFor(habit, todayKey);
    return {
      habit: toHabitDto(habit),
      log: input.done ? toLogDto(log) : null,
      done: input.done,
      stats,
    };
  }

  /** Статистика одной привычки по её отметкам (только done=true). */
  private async statsFor(habit: Habit, todayKey: string): Promise<HabitStatsDto> {
    const logs = await this.prisma.habitLog.findMany({
      where: { habitId: habit.id, done: true },
      select: { date: true },
    });
    const dayKeys = logs.map((log) => habitDateToDayKey(log.date));
    return habitStatsFromDayKeys(dayKeys, todayKey, habit.goalType as HabitCadence, habit.perWeek);
  }

  /** Привычки текущего дня с отметкой и серией (блок в чек-ине). */
  async today(userId: string): Promise<HabitTodayResponse> {
    const timeZone = await this.timeZone(userId);
    const todayKey = habitDayKey(new Date(), timeZone);

    const habits = await this.prisma.habit.findMany({
      where: { userId, archived: false },
      orderBy: { createdAt: 'asc' },
      include: { logs: { where: { done: true }, select: { date: true } } },
    });

    const items: HabitTodayItemDto[] = habits.map((habit) => {
      const dayKeys = habit.logs.map((log) => habitDateToDayKey(log.date));
      return {
        ...toHabitDto(habit),
        ...habitStatsFromDayKeys(dayKeys, todayKey, habit.goalType as HabitCadence, habit.perWeek),
        done: dayKeys.includes(todayKey),
      };
    });

    return { dayKey: todayKey, habits: items };
  }

  /** Серия и проценты за 7/30 дней по каждой привычке (экран /habits). */
  async stats(userId: string): Promise<HabitStatsResponse> {
    const timeZone = await this.timeZone(userId);
    const todayKey = habitDayKey(new Date(), timeZone);

    const habits = await this.prisma.habit.findMany({
      where: { userId },
      orderBy: [{ archived: 'asc' }, { createdAt: 'asc' }],
      include: { logs: { where: { done: true }, select: { date: true } } },
    });

    const items: HabitStatsItemDto[] = habits.map((habit) => {
      const dayKeys = habit.logs.map((log) => habitDateToDayKey(log.date));
      return {
        ...toHabitDto(habit),
        ...habitStatsFromDayKeys(dayKeys, todayKey, habit.goalType as HabitCadence, habit.perWeek),
      };
    });

    return { dayKey: todayKey, habits: items };
  }
}
