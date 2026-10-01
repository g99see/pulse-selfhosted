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
  guessCategoryName,
  importRowKey,
  parseCsv,
  summarizeImportRows,
  type Delimiter,
  type ImportColumnMapping,
  type ImportCommitRequest,
  type ImportPreviewRequest,
  type ImportPreviewRow,
  type ImportRowType,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from './accounts.service';
import { CategoriesService } from './categories.service';
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
  date: string;
  amount: number;
  type: ImportRowType;
  description: string;
  categoryId: string | null;
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
  ) {}

  async preview(userId: string, input: ImportPreviewRequest) {
    const parsed = this.parse(input);
    const existingKeys = await this.existingKeys(userId);
    const rows = buildImportPreview(parsed.rows, {
      mapping: parsed.mapping,
      hasHeader: parsed.hasHeader,
      existingKeys,
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

    const categories = await this.categories.list(userId);
    const categoryByName = new Map<string, string>();
    // list() отдаёт системные первыми, свои — следом; свои перекрывают системные по имени.
    for (const category of categories) {
      categoryByName.set(category.name.toLowerCase(), category.id);
    }

    const prepared: PreparedRow[] = valid.map((row) => {
      const key = importRowKey(row.date, row.amount, row.description);
      const guessed = row.description ? guessCategoryName(row.description) : null;
      return {
        hash: createHash('sha256').update(`${account.id}|${key}`).digest('hex'),
        date: row.date,
        amount: row.amount,
        type: row.type ?? 'expense',
        description: row.description,
        categoryId: guessed ? (categoryByName.get(guessed.toLowerCase()) ?? null) : null,
      };
    });

    const seen = new Set<string>();
    const unique = prepared.filter((row) => {
      if (seen.has(row.hash)) return false;
      seen.add(row.hash);
      return true;
    });
    const withinFileDuplicates = prepared.length - unique.length;

    const outcome = await this.prisma.$transaction(async (db) => {
      const existing = await db.transaction.findMany({
        where: { userId, importHash: { in: unique.map((row) => row.hash) } },
        select: { importHash: true },
      });
      const existingHashes = new Set(existing.map((row) => row.importHash));
      const fresh = unique.filter((row) => !existingHashes.has(row.hash));

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
            date: toDateOnly(row.date),
            comment: row.description === '' ? null : row.description,
            importHash: row.hash,
          })),
          skipDuplicates: true,
        });
        imported = created.count;
      }

      const delta = fresh.reduce(
        (sum, row) => sum + (row.type === 'income' ? row.amount : -row.amount),
        0,
      );
      const updated = await db.account.update({
        where: { id: account.id },
        data: { balance: { increment: new Prisma.Decimal(delta) } },
      });

      return { imported, balance: Number(updated.balance) };
    });

    return {
      imported: outcome.imported,
      duplicates: withinFileDuplicates + (unique.length - outcome.imported),
      invalid: preview.length - valid.length,
      total: preview.length,
      balance: outcome.balance,
    };
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

  /** Ключи существующих транзакций пользователя (дата|сумма|описание) для пометки дублей. */
  private async existingKeys(userId: string): Promise<Set<string>> {
    const transactions = await this.prisma.transaction.findMany({
      where: { userId },
      select: { date: true, amount: true, comment: true },
    });
    return new Set(
      transactions.map((transaction) =>
        importRowKey(
          transaction.date.toISOString().slice(0, 10),
          Number(transaction.amount),
          transaction.comment ?? '',
        ),
      ),
    );
  }
}
