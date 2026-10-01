// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Чек-ины самочувствия (ТЗ §3.3, §7): настроение 1–5 эмодзи-кнопками,
 * расширенный чек-ин, вечерний итог дня, заполнение задним числом и расписание
 * напоминаний 1–6 раз в день. Схемы общие для API и web.
 */
import { z } from 'zod';

/** Шкала 1–5: настроение, энергия, стресс (ТЗ §3.3). */
export const MoodSchema = z.number().int().min(1).max(5);

/** Провал дня, к которому относится чек-ин. */
export const CHECKIN_SLOTS = ['morning', 'day', 'evening'] as const;
export const CheckInSlotSchema = z.enum(CHECKIN_SLOTS);
export type CheckInSlot = z.infer<typeof CheckInSlotSchema>;

/** Готовые теги (ТЗ §3.3): работу, спорт, ссору и болезнь отмечают чаще всего. */
export const CHECKIN_TAG_SUGGESTIONS = ['работа', 'спорт', 'ссора', 'болею'] as const;

/** Пропущенный чек-ин можно заполнить задним числом в течение 24 часов (ТЗ §3.3). */
export const CHECKIN_BACKDATE_HOURS = 24;

/** Момент чек-ина: ISO-строка (для заполнения задним числом). */
const occurredAtSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Некорректная дата' });

export const CheckInInputSchema = z.object({
  mood: MoodSchema,
  energy: MoodSchema.optional(),
  stress: MoodSchema.optional(),
  sleepHours: z.number().min(0).max(24).optional(),
  /** Выпито воды, стаканов. */
  water: z.number().int().min(0).max(50).optional(),
  /** Шаги за день. */
  steps: z.number().int().min(0).max(200_000).optional(),
  tags: z.array(z.string().min(1).max(64)).max(20).default([]),
  note: z.string().max(2000).optional(),
  /** Вечерний итог дня: «Что сегодня получилось?» — одна строка (ТЗ §3.3). */
  daySummary: z.string().trim().max(280).optional(),
  slot: CheckInSlotSchema.optional(),
  /** Когда чек-ин был заполнен по факту (для заполнения задним числом). */
  occurredAt: occurredAtSchema.optional(),
});

export type CheckInInput = z.infer<typeof CheckInInputSchema>;
export type CheckInInputValues = z.input<typeof CheckInInputSchema>;

/** Правка чек-ина: любое подмножество полей. */
export const CheckInUpdateSchema = CheckInInputSchema.partial();
export type CheckInUpdateInput = z.infer<typeof CheckInUpdateSchema>;

/** Период выборки чек-инов. */
export const CheckInFilterSchema = z.object({
  from: occurredAtSchema.optional(),
  to: occurredAtSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type CheckInFilter = z.infer<typeof CheckInFilterSchema>;

/* ----- Расписание (ТЗ §3.3): по умолчанию 3 раза, настраивается 1–6 ----- */

export const CHECKIN_TIMES_PER_DAY_MIN = 1;
export const CHECKIN_TIMES_PER_DAY_MAX = 6;

/** Время напоминания в формате HH:MM (00:00–23:59). */
export const checkInTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  message: 'Время в формате HH:MM',
});

export const CheckInScheduleSchema = z
  .object({
    timesPerDay: z
      .number()
      .int()
      .min(CHECKIN_TIMES_PER_DAY_MIN)
      .max(CHECKIN_TIMES_PER_DAY_MAX),
    times: z
      .array(checkInTimeSchema)
      .min(CHECKIN_TIMES_PER_DAY_MIN)
      .max(CHECKIN_TIMES_PER_DAY_MAX),
  })
  .superRefine((value, ctx) => {
    if (value.times.length !== value.timesPerDay) {
      ctx.addIssue({
        code: 'custom',
        path: ['times'],
        message: 'Число напоминаний должно совпадать с числом времён',
      });
    }
    if (new Set(value.times).size !== value.times.length) {
      ctx.addIssue({ code: 'custom', path: ['times'], message: 'Времена не должны повторяться' });
    }
  });
export type CheckInScheduleInput = z.infer<typeof CheckInScheduleSchema>;

/** Расписание по умолчанию: утро, день и вечер (ТЗ §3.3, §5 сценарий 1). */
export const DEFAULT_CHECKIN_SCHEDULE: { timesPerDay: number; times: string[] } = {
  timesPerDay: 3,
  times: ['09:00', '15:00', '21:00'],
};

/* ----- Контракты ответов API ----- */

export interface CheckInDto {
  id: string;
  mood: number;
  energy: number | null;
  stress: number | null;
  sleepHours: number | null;
  water: number | null;
  steps: number | null;
  tags: string[];
  note: string | null;
  daySummary: string | null;
  slot: CheckInSlot | null;
  occurredAt: string;
  createdAt: string;
}

export interface CheckInScheduleDto {
  timesPerDay: number;
  times: string[];
}

/* ----- Утилиты ----- */

/** Ещё меньше 24 часов с момента чек-ина? (ТЗ §3.3). */
export function isWithinBackdateWindow(occurredAt: Date, now: Date = new Date()): boolean {
  const elapsed = now.getTime() - occurredAt.getTime();
  return elapsed <= CHECKIN_BACKDATE_HOURS * 60 * 60 * 1000;
}

/**
 * Границы календарных суток (полночь → полночь) и ключ дня YYYY-MM-DD
 * в часовом поясе пользователя. Время вне зоны (DST) считается по началу суток.
 */
export function dayBoundsInTimeZone(
  date: Date,
  timeZone: string,
): { start: Date; end: Date; dayKey: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((item) => item.type === type)?.value ?? '0';
    const parsed = Number(part);
    return type === 'hour' && parsed === 24 ? 0 : parsed;
  };

  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = value('hour');
  const minute = value('minute');
  const second = value('second');

  const dayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Смещение зоны относительно UTC на этот момент, с учётом летнего времени.
  const offset = Date.UTC(year, month - 1, day, hour, minute, second) - date.getTime();
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offset);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start, end, dayKey };
}
