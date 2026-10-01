// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Утилиты чек-инов для интерфейса (ТЗ §3.3): провал дня по часу ответа и
 * ближайшее время из расписания.
 */
import type { CheckInSlot } from '@puls/shared';

/** Провал дня по часу ответа: утро до 12, день до 18, вечер после. */
export function slotForHour(hour: number): CheckInSlot {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'day';
  return 'evening';
}

/** Ближайшее время HH:MM из расписания к моменту `now`; null, если список пуст. */
export function nearestScheduledTime(times: readonly string[], now: Date): string | null {
  const target = now.getHours() * 60 + now.getMinutes();
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const time of times) {
    const [hours, minutes] = time.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) continue;
    const distance = Math.abs(hours * 60 + minutes - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = time;
    }
  }

  return best;
}
