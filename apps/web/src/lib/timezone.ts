// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Перевод «настенных часов» часового пояса в абсолютный момент и обратно.
 *
 * Время чек-ина задним числом ограничено окном «последние 24 часа», а выбор
 * показывается в поясе пользователя (профиля), тогда как `<input
 * type="datetime-local">` оперирует настенными часами. Эти функции — мост
 * между двумя представлениями; они же нужны, когда пояс браузера не совпадает
 * с поясом профиля (QA-2 D1/D4).
 */

/** Смещение пояса (мс) относительно UTC на момент `date` — с учётом DST. */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
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

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const raw = parts.find((part) => part.type === type)?.value ?? '0';
    const parsed = Number(raw);
    // Полночь в некоторых поясах приходит как «24» — приводим к 0.
    return type === 'hour' && parsed === 24 ? 0 : parsed;
  };

  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return asUtc - date.getTime();
}

/** Настенные часы пояса `YYYY-MM-DDTHH:mm` → абсолютный ISO; null, если строка неверна. */
export function zonedWallClockToIso(wallClock: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wallClock.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const naive = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  if (!Number.isFinite(naive)) return null;

  // Смещение считаем дважды: второй проход уточняет переход на летнее время.
  const first = naive - timeZoneOffsetMs(new Date(naive), timeZone);
  const second = naive - timeZoneOffsetMs(new Date(first), timeZone);
  return new Date(second).toISOString();
}

/** Абсолютный момент → настенные часы пояса в формате `<input type="datetime-local">`. */
export function isoToZonedWallClock(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes): string => {
    const raw = parts.find((part) => part.type === type)?.value ?? '00';
    return type === 'hour' && raw === '24' ? '00' : raw;
  };

  return `${read('year')}-${read('month')}-${read('day')}T${read('hour')}:${read('minute')}`;
}

/** Час (0–23) момента в поясе — для проверок окна сна и слотов. */
export function hourInTimeZone(date: Date, timeZone: string): number {
  const raw = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .find((part) => part.type === 'hour')?.value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return parsed === 24 ? 0 : parsed;
}
