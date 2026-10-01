// SPDX-License-Identifier: AGPL-3.0-or-later
/** Ключ дня в формате YYYY-MM-DD (для DailyStat и тепловой карты). */
export function toDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Разница между периодами в процентах (ТЗ §3.4, «сравнение периодов»). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
