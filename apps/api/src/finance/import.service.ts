// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  buildImportPreview,
  detectColumnMapping,
  detectDelimiter,
  detectHeaderRow,
  convertToBase,
  importOccurrenceKey,
  importRowKey,
  matchCategoryByText,
  analyzeStatement,
  toCents,
  roundRate,
  type StatementRow,
  type Currency,
  parseCsv,
  summarizeImportRows,
  type Delimiter,
  type ImportColumnMapping,
  type ImportCommitRequest,
  type ImportPreviewRequest,
  type ImportPreviewRow,
  type ImportRecognition,
  type ImportRowType,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { InternalEvents } from '../common/internal-events';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from './accounts.service';
import { CategoriesService } from './categories.service';
import { MerchantsService } from './merchants.service';
import { ExchangeRatesService } from './rates.service';
import { toDateOnly } from './transactions.service';

interface ParsedImport {
  delimiter: Delimiter;
  hasHeader: boolean;
  headers: string[];
  mapping: ImportColumnMapping;
  rows: string[][];
}

interface PreparedRow {
  hash: string;
  /** Хеш прежней схемы (по содержимому) — для строк с ID банка: файл мог быть импортирован до появления ID. */
  legacyHash: string | null;
  date: string;
  amount: number;
  type: ImportRowType;
  description: string;
  categoryId: string | null;
  externalId: string | null;
  time: string | null;
  balance: number | null;
}

/** Хеш ключа идемпотентности строки в рамках счёта. */
function hashKey(accountId: string, key: string): string {
  return createHash('sha256').update(`${accountId}|${key}`).digest('hex');
}

/**
 * Импорт банковской выписки из CSV (ТЗ §3.2): разбор файла, сопоставление
 * колонок, автоопределение категорий, пометка дублей и запись транзакций
 * пачкой с обновлением баланса счёта. Повторный импорт того же файла в тот же
 * счёт не создаёт дублей (идемпотентность по хешу строки).
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
    private readonly merchants: MerchantsService,
    private readonly rates: ExchangeRatesService,
  ) {}

  async preview(userId: string, input: ImportPreviewRequest) {
    const parsed = this.parse(input);
    const [existingKeys, existingExternalIds] = await Promise.all([
      this.existingKeys(userId),
      this.existingExternalIds(userId),
    ]);
    const recognizer = await this.buildRecognizer(userId);
    const rows = buildImportPreview(parsed.rows, {
      mapping: parsed.mapping,
      hasHeader: parsed.hasHeader,
      existingKeys,
      existingExternalIds,
      recognize: recognizer,
    });

    return {
      delimiter: parsed.delimiter,
      hasHeader: parsed.hasHeader,
      headers: parsed.headers,
      mapping: parsed.mapping,
      rows,
      summary: summarizeImportRows(rows),
      limits: { maxBytes: IMPORT_MAX_BYTES, maxRows: IMPORT_MAX_ROWS },
    };
  }

  /**
   * Готовит распознавание магазинов для предпросмотра: один индекс (свои + общая
   * база) и карта названий категорий, чтобы не поднимать базу на каждую строку.
   */
  private async buildRecognizer(
    userId: string,
  ): Promise<(description: string, kind: ImportRowType | null) => ImportRecognition | null> {
    const [index, categories] = await Promise.all([
      this.merchants.prepare(userId),
      this.categories.list(userId),
    ]);
    const nameById = new Map(categories.map((category) => [category.id, category.name]));
    return (description: string, kind: ImportRowType | null) => {
      // 1. Магазин: своя база приоритетнее общей (ТЗ v2 §9).
      const match = this.merchants.recognizeBatch(index, description);
      if (match) {
        return {
          categoryId: match.categoryId,
          categoryName: nameById.get(match.categoryId) ?? null,
          merchantName: match.name,
        };
      }
      // 2. Категория по алиасу дерева, если магазин не распознан (родовые траты).
      const byAlias = matchCategoryByText(description, categories, kind ?? undefined);
      if (byAlias) {
        return {
          categoryId: byAlias,
          categoryName: nameById.get(byAlias) ?? null,
          merchantName: null,
        };
      }
      // 3. Не распознано — операция попадёт в очередь «Требует внимания».
      return null;
    };
  }

  async commit(userId: string, input: ImportCommitRequest) {
    const account = await this.accounts.resolveOwned(userId, input.accountId);
    const parsed = this.parse(input);
    const preview = buildImportPreview(parsed.rows, {
      mapping: parsed.mapping,
      hasHeader: parsed.hasHeader,
    });

    const valid = preview.filter(
      (row): row is ImportPreviewRow & { date: string; amount: number } =>
        row.error === null && row.date !== null && row.amount !== null && row.amount > 0,
    );

    const recognizer = await this.buildRecognizer(userId);
    const prepared: PreparedRow[] = valid.map((row) => {
      // Одинаковые строки выписки — разные операции: номер повтора входит в хеш.
      // Если банк прислал ID операции — он и есть ключ идемпотентности (переживает правки
      // описания и перенос времени); иначе — хеш (дата, сумма, описание, номер повтора).
      const key = importOccurrenceKey(
        importRowKey(row.date, row.amount, row.description),
        row.occurrence,
      );
      const recognition = row.description ? recognizer(row.description, row.type) : null;
      return {
        hash:
          row.externalId !== null
            ? hashKey(account.id, `ext:${row.externalId}`)
            : hashKey(account.id, key),
        legacyHash: row.externalId !== null ? hashKey(account.id, key) : null,
        date: row.date,
        amount: row.amount,
        type: row.type ?? 'expense',
        description: row.description,
        categoryId: recognition?.categoryId ?? null,
        externalId: row.externalId,
        time: row.time,
        balance: row.balance,
      };
    });

    const seen = new Set<string>();
    const unique = prepared.filter((row) => {
      if (seen.has(row.hash)) return false;
      seen.add(row.hash);
      return true;
    });
    const withinFileDuplicates = prepared.length - unique.length;

    // Сумма в базовой валюте нужна статистике, бюджетам и AI: без неё траты считаются как 0.
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { currency: true },
    });
    const rateByDate = new Map<string, number>();
    for (const date of new Set(unique.map((row) => row.date))) {
      rateByDate.set(
        date,
        account.currency === user.currency
          ? 1
          : await this.rates.resolveRate(
              userId,
              account.currency as Currency,
              user.currency as Currency,
              date,
            ),
      );
    }

    const outcome = await this.prisma.$transaction(async (db) => {
      const existing = await db.transaction.findMany({
        where: {
          userId,
          importHash: {
            in: unique.flatMap((row) => (row.legacyHash ? [row.hash, row.legacyHash] : [row.hash])),
          },
        },
        select: { id: true, importHash: true, externalId: true },
      });
      const existingHashes = new Set(existing.map((row) => row.importHash));
      const fresh = unique.filter(
        (row) =>
          !existingHashes.has(row.hash) && !(row.legacyHash && existingHashes.has(row.legacyHash)),
      );
      // Операции, импортированные раньше без ID банка, донаполняем ID, временем и остатком.
      for (const row of unique) {
        if (!row.legacyHash || !existingHashes.has(row.legacyHash)) continue;
        const old = existing.find((item) => item.importHash === row.legacyHash);
        if (!old || old.externalId !== null) continue;
        await db.transaction.update({
          where: { id: old.id },
          data: {
            externalId: row.externalId,
            bankTime: row.time,
            bankBalance: row.balance !== null ? new Prisma.Decimal(row.balance) : null,
          },
        });
      }

      let imported = 0;
      if (fresh.length > 0) {
        const created = await db.transaction.createMany({
          data: fresh.map((row) => ({
            userId,
            accountId: account.id,
            categoryId: row.categoryId,
            type: row.type,
            amount: new Prisma.Decimal(row.amount),
            currency: account.currency,
            rate: new Prisma.Decimal(roundRate(rateByDate.get(row.date) ?? 1)),
            amountBase: new Prisma.Decimal(
              convertToBase(row.amount, rateByDate.get(row.date) ?? 1),
            ),
            date: toDateOnly(row.date),
            comment: row.description === '' ? null : row.description,
            importHash: row.hash,
            externalId: row.externalId,
            bankTime: row.time,
            bankBalance: row.balance !== null ? new Prisma.Decimal(row.balance) : null,
          })),
          skipDuplicates: true,
        });
        imported = created.count;
      }

      // Дельта баланса — в Decimal: суммы вида 0.1 + 0.2 не копят хвост float.
      const delta = fresh.reduce(
        (sum, row) => sum.plus(row.type === 'income' ? row.amount : -row.amount),
        new Prisma.Decimal(0),
      );
      const updated = await db.account.update({
        where: { id: account.id },
        data: { balance: { increment: delta } },
      });

      const statementId = await this.saveStatementBalance(db, userId, account.id, unique);

      // Расходы по категориям и месяцам — для предупреждений бюджета.
      const additions = new Map<
        string,
        { categoryId: string; month: string; amountBase: number }
      >();
      for (const row of fresh) {
        if (row.type !== 'expense' || !row.categoryId) continue;
        const month = row.date.slice(0, 7);
        const key = `${row.categoryId}:${month}`;
        const entry = additions.get(key) ?? { categoryId: row.categoryId, month, amountBase: 0 };
        entry.amountBase += convertToBase(row.amount, rateByDate.get(row.date) ?? 1);
        additions.set(key, entry);
      }

      return {
        imported,
        balance: Number(updated.balance),
        statementId,
        additions: [...additions.values()],
      };
    });

    InternalEvents.emit('achievement.check', { userId, event: 'import' });

    if (outcome.additions.length > 0) {
      InternalEvents.emit('import.expenses', { userId, additions: outcome.additions });
    }

    // Сверка после импорта: подписчик уведомлений сам решит, есть ли расхождение.
    if (outcome.statementId) {
      InternalEvents.emit('statement.imported', {
        userId,
        accountId: account.id,
        statementId: outcome.statementId,
      });
    }

    return {
      imported: outcome.imported,
      duplicates: withinFileDuplicates + (unique.length - outcome.imported),
      invalid: preview.length - valid.length,
      total: preview.length,
      balance: outcome.balance,
    };
  }

  /**
   * Запоминает баланс по банку из выписки (колонка «Баланс») — основа сверки.
   * Хранится закрывающий остаток (по цепочке остатков) и строки выписки.
   */
  private async saveStatementBalance(
    db: Prisma.TransactionClient,
    userId: string,
    accountId: string,
    rows: readonly PreparedRow[],
  ): Promise<string | null> {
    const statementRows: StatementRow[] = rows.map((row) => ({
      externalId: row.externalId,
      date: row.date,
      time: row.time,
      amountCents: toCents(row.type === 'income' ? row.amount : -row.amount),
      balanceCents: row.balance !== null ? toCents(row.balance) : null,
      description: row.description,
    }));
    if (statementRows.length === 0 || statementRows.some((row) => row.balanceCents === null)) {
      return null;
    }
    const analysis = analyzeStatement(statementRows);
    if (analysis.closingCents === null) return null;
    const last = analysis.ordered[analysis.ordered.length - 1];
    const first = analysis.ordered[0];
    const created = await db.accountBankBalance.create({
      data: {
        userId,
        accountId,
        source: 'statement',
        balance: new Prisma.Decimal(analysis.closingCents).div(100),
        asOf: toDateOnly(last.date),
        periodFrom: toDateOnly(first.date),
        periodTo: toDateOnly(last.date),
        rows: analysis.ordered as unknown as Prisma.InputJsonValue,
      },
    });
    // Хранить достаточно несколько последних выписок.
    const stale = await db.accountBankBalance.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      skip: 5,
      select: { id: true },
    });
    if (stale.length > 0) {
      await db.accountBankBalance.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    }
    return created.id;
  }

  /** ID банка всех импортированных операций пользователя. */
  private async existingExternalIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.transaction.findMany({
      where: { userId, externalId: { not: null } },
      select: { externalId: true },
    });
    return new Set(rows.flatMap((row) => (row.externalId ? [row.externalId] : [])));
  }

  /** Разбирает запрос: лимиты, разделитель, заголовок и сопоставление колонок. */
  private parse(input: ImportPreviewRequest): ParsedImport {
    if (Buffer.byteLength(input.csv, 'utf8') > IMPORT_MAX_BYTES) {
      throw httpError(413, 'import_too_large', 'Файл больше 2 МБ');
    }

    const delimiter = input.delimiter ?? detectDelimiter(input.csv);
    const rows = parseCsv(input.csv, delimiter);
    const hasHeader = input.hasHeader ?? detectHeaderRow(rows);

    const dataRowCount = hasHeader ? Math.max(rows.length - 1, 0) : rows.length;
    if (dataRowCount > IMPORT_MAX_ROWS) {
      throw httpError(400, 'import_too_many_rows', 'Больше 10 000 строк');
    }
    if (rows.length === 0) {
      throw httpError(400, 'validation_error', 'Файл пуст');
    }

    const headers = hasHeader
      ? rows[0]
      : Array.from({ length: rows[0].length }, (_, index) => `Колонка ${index + 1}`);
    const sample = hasHeader ? rows.slice(1, 6) : rows.slice(0, 5);
    const mapping =
      input.mapping && Object.keys(input.mapping).length > 0
        ? input.mapping
        : detectColumnMapping(headers, sample);

    return { delimiter, hasHeader, headers, mapping, rows };
  }

  /** Сколько у пользователя операций с каждым ключом (дата|сумма|описание) — для пометки дублей. */
  private async existingKeys(userId: string): Promise<Map<string, number>> {
    const transactions = await this.prisma.transaction.findMany({
      where: { userId },
      select: { date: true, amount: true, comment: true },
    });
    const counts = new Map<string, number>();
    for (const transaction of transactions) {
      const key = importRowKey(
        transaction.date.toISOString().slice(0, 10),
        Number(transaction.amount),
        transaction.comment ?? '',
      );
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }
}
