// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Сверка счёта с банком (ТЗ v2 §3). Чистая логика: деньги считаются в целых
 * копейках (никакой плавающей точки в суммах), порядок строк выписки
 * восстанавливается по цепочке остатков, операции Пульса сопоставляются со
 * строками выписки по ID банка либо по (дата, сумма, описание).
 */
import { z } from 'zod';

/* ----- Деньги в целых копейках ----- */

/** Сумма в копейках (целое). Округление до ближайшей копейки убирает хвосты float. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Точная сумма денежных значений: складывает копейки, а не числа с плавающей точкой. */
export function sumMoney(values: readonly number[]): number {
  let cents = 0;
  for (const value of values) cents += toCents(value);
  return fromCents(cents);
}

/* ----- Строки выписки ----- */

export interface StatementRow {
  /** ID операции в банке (если колонка есть). */
  externalId: string | null;
  /** День «YYYY-MM-DD». */
  date: string;
  /** Время «HH:MM» (если есть). */
  time: string | null;
  /** Знаковая сумма в копейках: расход < 0, доход > 0. */
  amountCents: number;
  /** Остаток по банку после операции, в копейках. */
  balanceCents: number | null;
  description: string;
}

function rowKey(row: Pick<StatementRow, 'date' | 'time'>): string {
  return `${row.date} ${row.time ?? '00:00'}`;
}

/** Все перестановки не нужны: ищем порядок группы одинаковых минут перебором с возвратом. */
function orderTieGroup(
  group: StatementRow[],
  previousBalance: number | null,
): StatementRow[] | null {
  if (group.length > 7 || group.some((row) => row.balanceCents === null)) return null;
  const used = new Array<boolean>(group.length).fill(false);
  const result: StatementRow[] = [];

  const search = (balance: number | null): boolean => {
    if (result.length === group.length) return true;
    for (let index = 0; index < group.length; index += 1) {
      if (used[index]) continue;
      const row = group[index];
      if (balance !== null && balance + row.amountCents !== row.balanceCents) continue;
      used[index] = true;
      result.push(row);
      if (search(row.balanceCents)) return true;
      result.pop();
      used[index] = false;
    }
    return false;
  };

  return search(previousBalance) ? [...result] : null;
}

/**
 * Приводит строки выписки к хронологическому порядку. Файл банка обычно идёт от
 * новых к старым; внутри одной минуты порядок строк в файле не гарантирован, поэтому
 * его подбирают так, чтобы остатки сходились цепочкой «остаток + сумма = следующий остаток».
 */
export function orderStatementRows(rows: readonly StatementRow[]): StatementRow[] {
  if (rows.length < 2) return [...rows];
  const newestFirst = rowKey(rows[0]) > rowKey(rows[rows.length - 1]);
  const chronological = (newestFirst ? [...rows].reverse() : [...rows]).sort((left, right) =>
    rowKey(left) < rowKey(right) ? -1 : rowKey(left) > rowKey(right) ? 1 : 0,
  );

  const ordered: StatementRow[] = [];
  let previousBalance = null as number | null;
  let index = 0;
  while (index < chronological.length) {
    let end = index + 1;
    while (
      end < chronological.length &&
      rowKey(chronological[end]) === rowKey(chronological[index])
    ) {
      end += 1;
    }
    const group = chronological.slice(index, end);
    const arranged: StatementRow[] | null =
      group.length > 1 ? orderTieGroup(group, previousBalance) : null;
    const placed: StatementRow[] = arranged ?? group;
    ordered.push(...placed);
    const last: StatementRow = placed[placed.length - 1];
    previousBalance = last.balanceCents ?? previousBalance;
    index = end;
  }
  return ordered;
}

export interface ChainBreak {
  /** Индекс строки в хронологическом порядке. */
  index: number;
  row: StatementRow;
  /** Какой остаток должен быть по цепочке, в копейках. */
  expectedCents: number;
  /** Остаток, указанный банком, в копейках. */
  actualCents: number;
}

export interface StatementAnalysis {
  ordered: StatementRow[];
  /** Остаток до первой операции периода (если известен). */
  openingCents: number | null;
  /** Остаток после последней операции — «баланс по банку». */
  closingCents: number | null;
  /** Разрывы цепочки остатков: здесь в выписке или в Пульсе чего-то не хватает. */
  breaks: ChainBreak[];
  /** Сумма операций выписки, копейки. */
  totalCents: number;
}

export function analyzeStatement(rows: readonly StatementRow[]): StatementAnalysis {
  const ordered = orderStatementRows(rows);
  const breaks: ChainBreak[] = [];
  let totalCents = 0;
  let previousBalance = null as number | null;
  let openingCents = null as number | null;
  let closingCents = null as number | null;

  ordered.forEach((row, index) => {
    totalCents += row.amountCents;
    if (row.balanceCents === null) return;
    if (previousBalance === null) {
      if (openingCents === null) openingCents = row.balanceCents - row.amountCents;
    } else if (previousBalance + row.amountCents !== row.balanceCents) {
      breaks.push({
        index,
        row,
        expectedCents: previousBalance + row.amountCents,
        actualCents: row.balanceCents,
      });
    }
    previousBalance = row.balanceCents;
    closingCents = row.balanceCents;
  });

  return { ordered, openingCents, closingCents, breaks, totalCents };
}

/* ----- Сопоставление с операциями Пульса ----- */

export interface PulseOperation {
  id: string;
  externalId: string | null;
  date: string;
  /** Знаковая сумма на этом счёте в копейках. */
  amountCents: number;
  description: string;
  /** Введена вручную (не из импорта). */
  manual: boolean;
}

export interface MatchResult {
  missingInPulse: StatementRow[];
  extraInPulse: PulseOperation[];
}

function normalizeDescription(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Сопоставляет выписку и операции Пульса за её период. Три прохода: по ID банка,
 * по (дата, сумма, описание), по (дата, сумма). Лишнее с обеих сторон — расхождения.
 */
export function matchStatement(
  statement: readonly StatementRow[],
  operations: readonly PulseOperation[],
): MatchResult {
  const restRows = new Set(statement.map((_, index) => index));
  const restOps = new Set(operations.map((_, index) => index));

  const pair = (
    keyOfRow: (row: StatementRow) => string | null,
    keyOfOp: (op: PulseOperation) => string | null,
  ) => {
    const buckets = new Map<string, number[]>();
    for (const index of restOps) {
      const key = keyOfOp(operations[index]);
      if (key === null) continue;
      const list = buckets.get(key) ?? [];
      list.push(index);
      buckets.set(key, list);
    }
    for (const index of [...restRows]) {
      const key = keyOfRow(statement[index]);
      if (key === null) continue;
      const candidate = buckets.get(key)?.shift();
      if (candidate === undefined) continue;
      restRows.delete(index);
      restOps.delete(candidate);
    }
  };

  pair(
    (row) => row.externalId,
    (op) => op.externalId,
  );
  pair(
    (row) => `${row.date}|${row.amountCents}|${normalizeDescription(row.description)}`,
    (op) => `${op.date}|${op.amountCents}|${normalizeDescription(op.description)}`,
  );
  pair(
    (row) => `${row.date}|${row.amountCents}`,
    (op) => `${op.date}|${op.amountCents}`,
  );

  return {
    missingInPulse: [...restRows].sort((a, b) => a - b).map((index) => statement[index]),
    extraInPulse: [...restOps].sort((a, b) => a - b).map((index) => operations[index]),
  };
}

/* ----- Типы ответа API ----- */

export type ReconciliationItemKind = 'chain_break' | 'missing_in_pulse' | 'extra_in_pulse';

export interface ReconciliationItem {
  kind: ReconciliationItemKind;
  date: string;
  time: string | null;
  /** Знаковая сумма операции. */
  amount: number;
  description: string;
  externalId: string | null;
  /** Для extra_in_pulse: id операции Пульса и признак ручного ввода. */
  transactionId: string | null;
  manual: boolean;
  /** Для chain_break: ожидаемый и фактический остаток по банку. */
  expectedBalance: number | null;
  actualBalance: number | null;
}

export interface ReconciliationResponse {
  accountId: string;
  accountName: string;
  currency: string;
  /** Текущий баланс счёта в Пульсе. */
  pulseBalance: number;
  /** Баланс Пульса на дату сверки (без операций, внесённых позже). */
  pulseBalanceAsOf: number | null;
  /** Баланс по банку: из выписки либо введён вручную; null — сверять не с чем. */
  bankBalance: number | null;
  bankSource: 'statement' | 'manual' | null;
  /** Дата, на которую известен баланс банка. */
  bankAsOf: string | null;
  /** Пульс − банк на дату сверки; 0 — счёт сходится. */
  difference: number | null;
  /** Часть расхождения, объяснённая найденными операциями. */
  explained: number | null;
  /** Остаток расхождения без объяснения (например, начальный баланс счёта). */
  unexplained: number | null;
  /** Операции после даты сверки: их нет в расхождении. */
  afterBank: { count: number; net: number };
  period: { from: string; to: string } | null;
  statementRows: number;
  items: ReconciliationItem[];
}

export const BankBalanceInputSchema = z.object({
  balance: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type BankBalanceInput = z.infer<typeof BankBalanceInputSchema>;
