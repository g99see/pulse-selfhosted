// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Приведение значений из PostgreSQL к JSON-безопасному виду (ТЗ §3.1):
 * даты — ISO-строкой, Decimal — числом, bigint и бинарь — строкой.
 * Используется и в JSON-документе, и в CSV, чтобы форматы не расходились.
 */

interface DecimalLike {
  toNumber(): number;
}

function isDecimalLike(value: unknown): value is DecimalLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DecimalLike).toNumber === 'function' &&
    typeof (value as { toFixed?: unknown }).toFixed === 'function'
  );
}

export function toJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (isDecimalLike(value)) return value.toNumber();
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toJsonSafe(item);
    }
    return result;
  }
  return value;
}

/** Строковое представление значения для CSV-ячейки. */
export function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (isDecimalLike(value)) return String(value);
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(toJsonSafe(value));
  return String(value);
}
