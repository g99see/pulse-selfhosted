// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Импорт банковской выписки из CSV (ТЗ §3.2). Чистая логика, общая для API и web:
 * парсер RFC 4180, определение разделителя и колонок, разбор дат и сумм,
 * автоопределение категорий и пометка дублей. Кодировку (UTF-8/windows-1251)
 * снимает вызывающая сторона (на web — через TextDecoder).
 */
import { z } from 'zod';
import { guessCategoryName } from './finance';

/** Лимит размера файла: 2 МБ (ТЗ §3.2). */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
/** Лимит числа строк данных: 10 000 (ТЗ §3.2). */
export const IMPORT_MAX_ROWS = 10_000;

export const DELIMITERS = [',', ';', '\t'] as const;
export type Delimiter = (typeof DELIMITERS)[number];

export const IMPORT_COLUMNS = ['date', 'amount', 'description', 'type', 'debit', 'credit'] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export type ImportColumnMapping = Partial<Record<ImportColumn, number>>;

export type ImportRowType = 'expense' | 'income';

export interface ImportPreviewRow {
  /** Номер строки в файле (1-based, включая заголовок). */
  rowNumber: number;
  date: string | null;
  /** Абсолютная сумма (знак вынесен в type). */
  amount: number | null;
  type: ImportRowType | null;
  description: string;
  categoryName: string | null;
  duplicate: boolean;
  error: 'invalid_date' | 'invalid_amount' | null;
}

export interface ImportPreviewSummary {
  total: number;
  valid: number;
  duplicates: number;
  errors: number;
}

const HEADER_WORDS = [
  'дата',
  'date',
  'сумма',
  'amount',
  'sum',
  'описание',
  'назначение',
  'комментарий',
  'примечание',
  'description',
  'details',
  'memo',
  'тип',
  'type',
  'расход',
  'списание',
  'дебет',
  'debit',
  'поступление',
  'зачисление',
  'приход',
  'доход',
  'кредит',
  'credit',
];

const COLUMN_KEYWORDS: ReadonlyArray<{ column: ImportColumn; words: readonly string[] }> = [
  { column: 'date', words: ['дата', 'date', 'проведен', 'operation date'] },
  { column: 'debit', words: ['дебет', 'debit', 'расход', 'списание'] },
  { column: 'credit', words: ['кредит', 'credit', 'поступление', 'зачисление', 'приход', 'доход'] },
  { column: 'amount', words: ['сумма', 'amount', 'sum'] },
  {
    column: 'description',
    words: [
      'описание',
      'назначение',
      'комментарий',
      'примечание',
      'description',
      'details',
      'memo',
    ],
  },
  { column: 'type', words: ['тип', 'type', 'направление', 'вид операции'] },
];

const EXPENSE_TYPE_WORDS = [
  'расход',
  'списание',
  'дебет',
  'debit',
  'expense',
  'out',
  'оплата',
  'payment',
];
const INCOME_TYPE_WORDS = [
  'доход',
  'поступление',
  'зачисление',
  'приход',
  'кредит',
  'credit',
  'income',
  'in',
];

function normalizeCell(value: string | undefined): string {
  return (value ?? '').trim();
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Считает вхождения разделителя вне кавычек (для определения колонок). */
function countOutsideQuotes(text: string, delimiter: string): number[] {
  const perLine: number[] = [];
  let current = 0;
  let inQuotes = false;
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char === delimiter) current += 1;
    else if (!inQuotes && char === '\n') {
      perLine.push(current);
      current = 0;
    }
  }
  perLine.push(current);
  return perLine;
}

/** Определяет разделитель по первым строкам файла (ТЗ §3.2). */
export function detectDelimiter(text: string): Delimiter {
  const sample = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, 20)
    .join('\n');
  if (sample === '') return ',';

  let best: Delimiter = ',';
  let bestScore = -1;
  for (const candidate of DELIMITERS) {
    const counts = countOutsideQuotes(sample, candidate);
    const linesWithDelimiter = counts.filter((count) => count > 0).length;
    const total = counts.reduce((sum, count) => sum + count, 0);
    const score = linesWithDelimiter * 1000 + total;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** Парсер CSV по RFC 4180: кавычки, экранирование, переводы строк, BOM. */
export function parseCsv(text: string, delimiter?: Delimiter): string[][] {
  const input = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const sep = delimiter ?? detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
    } else if (char === sep) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((current) => !(current.length === 1 && current[0].trim() === ''));
}

function isHeaderLike(row: string[]): boolean {
  return row.some((cell) => {
    const header = normalizeHeader(cell);
    return header !== '' && HEADER_WORDS.some((word) => header.includes(word));
  });
}

function rowHasDateOrAmount(row: string[]): boolean {
  return row.some((cell) => parseImportDate(cell) !== null || parseImportAmount(cell) !== null);
}

/** Определяет, является ли первая строка заголовком (ТЗ §3.2). */
export function detectHeaderRow(rows: string[][]): boolean {
  if (rows.length === 0) return false;
  if (rows.length === 1) return isHeaderLike(rows[0]);
  return isHeaderLike(rows[0]) || (!rowHasDateOrAmount(rows[0]) && rowHasDateOrAmount(rows[1]));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Разбирает дату: dd.MM.yyyy, dd/MM/yyyy, dd-MM-yyyy, yyyy-MM-dd, yyyy.MM.dd (+ необязательное время). */
export function parseImportDate(value: string): string | null {
  const trimmed = normalizeCell(value);
  if (trimmed === '') return null;

  const yearFirst = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T\s].*)?$/.exec(trimmed);
  const dayFirst = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})(?:[T\s].*)?$/.exec(trimmed);

  let year: number;
  let month: number;
  let day: number;

  if (yearFirst) {
    year = Number(yearFirst[1]);
    month = Number(yearFirst[2]);
    day = Number(yearFirst[3]);
  } else if (dayFirst) {
    day = Number(dayFirst[1]);
    month = Number(dayFirst[2]);
    year = Number(dayFirst[3]);
    if (year < 100) year += 2000;
  } else {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Разбирает сумму: «1 234,56», «-450.00», «1,234.56», «(500,00)». */
export function parseImportAmount(value: string): number | null {
  let text = normalizeCell(value).replace(/[\s\u00A0\u202F\u2009]/g, '');
  if (text === '') return null;

  let parenthesizedNegative = false;
  if (/^\(.*\)$/.test(text)) {
    parenthesizedNegative = true;
    text = text.slice(1, -1);
  }

  const sign = text.includes('-') ? -1 : 1;
  text = text.replace(/[^\d.,]/g, '');
  if (text === '') return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  let normalized = text;

  if (lastComma > -1 && lastDot > -1) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    normalized = text.split(thousandsSeparator).join('').replace(decimalSeparator, '.');
  } else if (lastComma > -1) {
    normalized = text.split(',').length > 2 ? text.split(',').join('') : text.replace(',', '.');
  } else if (lastDot > -1) {
    normalized = text.split('.').length > 2 ? text.split('.').join('') : text;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;

  const signed = sign * Math.abs(parsed);
  return round2(parenthesizedNegative ? -Math.abs(signed) : signed);
}

/** Определяет тип операции по значению колонки «тип». */
export function parseImportRowType(value: string): ImportRowType | null {
  const normalized = normalizeHeader(value);
  if (normalized === '') return null;
  if (EXPENSE_TYPE_WORDS.some((word) => normalized.includes(word))) return 'expense';
  if (INCOME_TYPE_WORDS.some((word) => normalized.includes(word))) return 'income';
  return null;
}

function columnFraction(
  sample: string[][],
  index: number,
  test: (cell: string) => boolean,
): number {
  if (sample.length === 0) return 0;
  const values = sample.map((row) => normalizeCell(row[index])).filter((cell) => cell !== '');
  if (values.length === 0) return 0;
  return values.filter(test).length / values.length;
}

/** Автоопределение колонок по заголовкам, с запасным вариантом — по данным (ТЗ §3.2). */
export function detectColumnMapping(
  headers: string[],
  sample: string[][] = [],
): ImportColumnMapping {
  const mapping: ImportColumnMapping = {};
  const taken = new Set<number>();

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (normalized === '') return;
    for (const { column, words } of COLUMN_KEYWORDS) {
      if (mapping[column] !== undefined) continue;
      if (words.some((word) => normalized.includes(word))) {
        mapping[column] = index;
        taken.add(index);
        return;
      }
    }
  });

  const available = headers.map((_, index) => index).filter((index) => !taken.has(index));

  if (mapping.date === undefined) {
    const best = available
      .map((index) => ({
        index,
        fraction: columnFraction(sample, index, (cell) => parseImportDate(cell) !== null),
      }))
      .sort((a, b) => b.fraction - a.fraction)[0];
    if (best && best.fraction >= 0.5) {
      mapping.date = best.index;
      taken.add(best.index);
    }
  }

  const rest = headers.map((_, index) => index).filter((index) => !taken.has(index));

  if (mapping.amount === undefined && mapping.debit === undefined && mapping.credit === undefined) {
    const best = rest
      .map((index) => ({
        index,
        fraction: columnFraction(sample, index, (cell) => parseImportAmount(cell) !== null),
      }))
      .sort((a, b) => b.fraction - a.fraction)[0];
    if (best && best.fraction >= 0.5) {
      mapping.amount = best.index;
      taken.add(best.index);
    }
  }

  if (mapping.description === undefined) {
    const remaining = headers.map((_, index) => index).filter((index) => !taken.has(index));
    const best = remaining
      .map((index) => ({
        index,
        fraction: columnFraction(sample, index, (cell) => parseImportAmount(cell) === null),
      }))
      .sort((a, b) => b.fraction - a.fraction)[0];
    if (best && best.fraction > 0) mapping.description = best.index;
  }

  return mapping;
}

/** Канонический ключ строки для пометки дублей и идемпотентности импорта. */
export function importRowKey(date: string, amount: number, description: string): string {
  const normalized = description.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${date}|${amount.toFixed(2)}|${normalized}`;
}

export interface BuildImportPreviewOptions {
  mapping: ImportColumnMapping;
  hasHeader?: boolean;
  /** Ключи уже существующих транзакций (дата|сумма|описание). */
  existingKeys?: ReadonlySet<string>;
}

function cell(row: string[], index: number | undefined): string {
  if (index === undefined) return '';
  return normalizeCell(row[index]);
}

/** Строит строки предпросмотра: разбор, тип, категория, пометка дублей (ТЗ §3.2). */
export function buildImportPreview(
  rows: string[][],
  options: BuildImportPreviewOptions,
): ImportPreviewRow[] {
  const { mapping, hasHeader = false, existingKeys } = options;
  const preview: ImportPreviewRow[] = [];
  const seen = new Set<string>();

  const start = hasHeader ? 1 : 0;
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index];
    const dateValue = mapping.date !== undefined ? parseImportDate(cell(row, mapping.date)) : null;

    let amount: number | null = null;
    let type: ImportRowType | null = null;

    if (mapping.debit !== undefined || mapping.credit !== undefined) {
      const debit =
        mapping.debit !== undefined ? parseImportAmount(cell(row, mapping.debit)) : null;
      const credit =
        mapping.credit !== undefined ? parseImportAmount(cell(row, mapping.credit)) : null;
      if (debit !== null && Math.abs(debit) > 0) {
        amount = Math.abs(debit);
        type = 'expense';
      } else if (credit !== null && Math.abs(credit) > 0) {
        amount = Math.abs(credit);
        type = 'income';
      }
    } else if (mapping.amount !== undefined) {
      const raw = parseImportAmount(cell(row, mapping.amount));
      if (raw !== null && raw !== 0) {
        amount = Math.abs(raw);
        type = raw < 0 ? 'expense' : 'income';
      }
    }

    const explicitType =
      mapping.type !== undefined ? parseImportRowType(cell(row, mapping.type)) : null;
    if (explicitType && amount !== null) type = explicitType;

    const description = cell(row, mapping.description).slice(0, 500);
    const error: ImportPreviewRow['error'] =
      dateValue === null ? 'invalid_date' : amount === null ? 'invalid_amount' : null;

    let duplicate = false;
    if (error === null && dateValue !== null && amount !== null) {
      const key = importRowKey(dateValue, amount, description);
      duplicate = seen.has(key) || Boolean(existingKeys?.has(key));
      seen.add(key);
    }

    preview.push({
      rowNumber: index + 1,
      date: dateValue,
      amount,
      type,
      description,
      categoryName: description ? guessCategoryName(description) : null,
      duplicate,
      error,
    });
  }

  return preview;
}

/** Сводка предпросмотра для интерфейса. */
export function summarizeImportRows(rows: ImportPreviewRow[]): ImportPreviewSummary {
  return {
    total: rows.length,
    valid: rows.filter((row) => row.error === null).length,
    duplicates: rows.filter((row) => row.duplicate).length,
    errors: rows.filter((row) => row.error !== null).length,
  };
}

/* ----- Схемы запросов API ----- */

export const ImportColumnMappingSchema = z.object({
  date: z.number().int().min(0).optional(),
  amount: z.number().int().min(0).optional(),
  description: z.number().int().min(0).optional(),
  type: z.number().int().min(0).optional(),
  debit: z.number().int().min(0).optional(),
  credit: z.number().int().min(0).optional(),
});

export const ImportPreviewRequestSchema = z.object({
  csv: z.string().min(1, { message: 'Пустой файл' }).max(5_000_000),
  delimiter: z.enum(DELIMITERS).optional(),
  hasHeader: z.boolean().optional(),
  mapping: ImportColumnMappingSchema.optional(),
});
export type ImportPreviewRequest = z.infer<typeof ImportPreviewRequestSchema>;

export const ImportCommitRequestSchema = ImportPreviewRequestSchema.extend({
  accountId: z.string().min(1),
});
export type ImportCommitRequest = z.infer<typeof ImportCommitRequestSchema>;
