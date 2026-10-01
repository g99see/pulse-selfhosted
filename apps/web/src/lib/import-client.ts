// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент импорта банковской выписки (ТЗ §3.2): декодирование файла
 * (UTF-8, при неудаче windows-1251), предпросмотр и запись через API.
 */
import {
  IMPORT_MAX_BYTES,
  type ImportColumnMapping,
  type ImportCommitRequest,
  type ImportPreviewRequest,
  type ImportPreviewRow,
  type ImportPreviewSummary,
} from '@puls/shared';
import { authFetch } from './auth-client';

export type StatementEncoding = 'utf-8' | 'windows-1251';

export interface DecodedStatement {
  text: string;
  encoding: StatementEncoding;
}

export interface ImportPreviewResponse {
  delimiter: string;
  hasHeader: boolean;
  headers: string[];
  mapping: ImportColumnMapping;
  rows: ImportPreviewRow[];
  summary: ImportPreviewSummary;
  limits: { maxBytes: number; maxRows: number };
}

export interface ImportCommitResponse {
  imported: number;
  duplicates: number;
  invalid: number;
  total: number;
  balance: number;
}

export type ImportFileErrorCode = 'too_large' | 'read_failed';

export class ImportFileError extends Error {
  constructor(readonly code: ImportFileErrorCode) {
    super(code);
    this.name = 'ImportFileError';
  }
}

/** Декодирует байты выписки: сначала UTF-8, при ошибке — windows-1251 (ТЗ §3.2). */
export function decodeStatementFile(bytes: Uint8Array): DecodedStatement {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text, encoding: 'utf-8' };
  } catch {
    const text = new TextDecoder('windows-1251').decode(bytes);
    return { text, encoding: 'windows-1251' };
  }
}

/** Читает выбранный файл с проверкой лимита 2 МБ (ТЗ §3.2). */
export async function readStatementFile(file: File): Promise<DecodedStatement> {
  if (file.size > IMPORT_MAX_BYTES) {
    throw new ImportFileError('too_large');
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return decodeStatementFile(bytes);
  } catch (error) {
    if (error instanceof ImportFileError) throw error;
    throw new ImportFileError('read_failed');
  }
}

export const importApi = {
  preview: (input: ImportPreviewRequest) =>
    authFetch<ImportPreviewResponse>('/api/finance/import/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  commit: (input: ImportCommitRequest) =>
    authFetch<ImportCommitResponse>('/api/finance/import/commit', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
