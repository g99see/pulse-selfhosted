// SPDX-License-Identifier: AGPL-3.0-or-later
// Тесты клиента импорта выписки (ТЗ §3.2): декодирование UTF-8/windows-1251
// и чтение файла с лимитом размера.
import { describe, expect, it } from 'vitest';
import { IMPORT_MAX_BYTES } from '@puls/shared';
import { ImportFileError, decodeStatementFile, readStatementFile } from '../src/lib/import-client';

describe('decodeStatementFile', () => {
  it('декодирует UTF-8', () => {
    const bytes = new TextEncoder().encode('Дата;Сумма\n01.10.2026;-450,00');
    expect(decodeStatementFile(bytes)).toEqual({
      text: 'Дата;Сумма\n01.10.2026;-450,00',
      encoding: 'utf-8',
    });
  });

  it('переходит на windows-1251, если байты не UTF-8', () => {
    // «Привет» в windows-1251.
    const bytes = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    expect(decodeStatementFile(bytes)).toEqual({ text: 'Привет', encoding: 'windows-1251' });
  });
});

describe('readStatementFile', () => {
  it('читает файл в пределах лимита', async () => {
    const bytes = new TextEncoder().encode('a;b\n1;2');
    const file = {
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer,
    } as unknown as File;

    await expect(readStatementFile(file)).resolves.toMatchObject({ text: 'a;b\n1;2', encoding: 'utf-8' });
  });

  it('отклоняет файл больше 2 МБ', async () => {
    const file = {
      size: IMPORT_MAX_BYTES + 1,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as File;

    await expect(readStatementFile(file)).rejects.toBeInstanceOf(ImportFileError);
    await expect(readStatementFile(file)).rejects.toMatchObject({ code: 'too_large' });
  });
});
