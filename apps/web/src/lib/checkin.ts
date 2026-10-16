// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Утилиты чек-инов для интерфейса (ТЗ §3.3): провал дня по часу ответа и
 * ближайшее время из расписания.
 */
import { slotForLocalHour, type CheckInSlot } from '@puls/shared';

/**
 * Провал дня по локальному часу ответа. Единое определение лежит в @puls/shared
 * (`slotForLocalHour`): утро 04:00–12:00, день 12:00–18:00, вечер 18:00–04:00.
 */
export function slotForHour(hour: number): CheckInSlot {
  return slotForLocalHour(hour);
}

/**
 * Ключ вопроса о настроении по слоту (Фаза 0, §2.1): вечером спрашиваем про
 * день, утром и днём — про состояние прямо сейчас. Слот null (до гидратации)
 * даёт вопрос «прямо сейчас».
 */
export function checkinQuestionKey(slot: CheckInSlot | null): string {
  return slot === 'evening' ? 'checkin.question.daily' : 'checkin.question.momentary';
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
