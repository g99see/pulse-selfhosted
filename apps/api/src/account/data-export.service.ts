// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import { EXPORT_FORMAT_NAME, EXPORT_FORMAT_VERSION } from '@puls/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EXPORT_TABLES, isSecretColumn, listTableColumns, type ExportTable } from './data-registry';
import { toCsv } from './csv';
import { toJsonSafe } from './serialize';
import { createZip } from './zip';

export interface ExportDocument {
  format: string;
  version: number;
  generatedAt: string;
  user: Record<string, unknown> | null;
  counts: Record<string, number>;
  data: Record<string, Array<Record<string, unknown>>>;
}

export interface CsvFile {
  name: string;
  content: string;
}

interface TableSlice {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

/** Имя файла выгрузки: puls-export-<никнейм>-<ГГГГ-ММ-ДД>.<расширение>. */
export function exportFilename(nickname: string, extension: string, now = new Date()): string {
  return `puls-export-${nickname}-${now.toISOString().slice(0, 10)}.${extension}`;
}

/** Content-Disposition с ASCII-именем и RFC 5987-вариантом. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^ -~]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Полная выгрузка данных пользователя (ТЗ §3.1): единый JSON-документ с
 * версией формата либо ZIP с CSV по сущностям. Секреты не выгружаются — их
 * отсекает реестр (isSecretColumn) ещё на этапе выбора колонок.
 */
@Injectable()
export class DataExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportJson(userId: string): Promise<ExportDocument> {
    const document: ExportDocument = {
      format: EXPORT_FORMAT_NAME,
      version: EXPORT_FORMAT_VERSION,
      generatedAt: new Date().toISOString(),
      user: null,
      counts: {},
      data: {},
    };

    for (const entry of EXPORT_TABLES) {
      const { rows } = await this.readTable(entry, userId);
      const safe = rows.map((row) => toJsonSafe(row) as Record<string, unknown>);

      if (entry.entity === 'user') {
        document.user = safe[0] ?? null;
      } else {
        document.data[entry.entity] = safe;
        document.counts[entry.entity] = safe.length;
      }
    }

    return document;
  }

  async exportCsvFiles(userId: string): Promise<CsvFile[]> {
    const files: CsvFile[] = [];
    for (const entry of EXPORT_TABLES) {
      const { columns, rows } = await this.readTable(entry, userId);
      files.push({ name: `${entry.table}.csv`, content: toCsv(columns, rows) });
    }
    return files;
  }

  async exportZip(userId: string): Promise<Buffer> {
    const files = await this.exportCsvFiles(userId);
    return createZip(files.map((file) => ({ name: file.name, content: file.content })));
  }

  private async readTable(entry: ExportTable, userId: string): Promise<TableSlice> {
    const discovered = await listTableColumns(this.prisma, entry.table);
    const explicit = new Set(entry.secretColumns ?? []);
    const columns = discovered.filter((column) => !explicit.has(column) && !isSecretColumn(column));

    const selection = columns.map((column) => `"${column}"`).join(', ');
    const order = entry.orderBy ? ` ORDER BY ${entry.orderBy}` : '';
    const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT ${selection} FROM "${entry.table}" WHERE "${entry.keyColumn}" = $1${order}`,
      userId,
    );

    return { columns, rows };
  }
}
