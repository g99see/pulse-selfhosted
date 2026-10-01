// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CSV по RFC 4180 с защитой от инъекции формул (ТЗ §6). Текстовые значения,
 * начинающиеся с =, +, -, @, таба или CR, нейтрализуются одинарной кавычкой,
 * чтобы таблицы не выполняли их как формулы.
 */
import { stringifyValue } from './serialize';

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function sanitizeCsvValue(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Одна ячейка: формульные строки помечаются, спецсимволы экранируются кавычками. */
export function csvCell(value: unknown): string {
  const text = stringifyValue(value);
  return quote(typeof value === 'string' ? sanitizeCsvValue(text) : text);
}

/** Полный CSV: заголовок и строки через CRLF. */
export function toCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const lines = [columns.map((column) => quote(column)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
