// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты клиента выгрузки (ТЗ §3.1): разбор имени файла из заголовка.
import { describe, expect, it } from 'vitest';
import { exportFileExtension, filenameFromDisposition } from '../src/lib/account-client';

describe('filenameFromDisposition', () => {
  it('читает ASCII-имя', () => {
    const header =
      'attachment; filename="puls-export-tester-2026-10-01.json"; filename*=UTF-8\'\'puls-export-tester-2026-10-01.json';
    expect(filenameFromDisposition(header)).toBe('puls-export-tester-2026-10-01.json');
  });

  it('предпочитает RFC 5987-вариант и декодирует его', () => {
    const header =
      'attachment; filename="puls-export.zip"; filename*=UTF-8\'\'%D0%B2%D1%8B%D0%B3%D1%80%D1%83%D0%B7%D0%BA%D0%B0.zip';
    expect(filenameFromDisposition(header)).toBe('выгрузка.zip');
  });

  it('возвращает undefined, если имени нет', () => {
    expect(filenameFromDisposition('attachment')).toBeUndefined();
    expect(filenameFromDisposition('')).toBeUndefined();
  });
});

describe('exportFileExtension', () => {
  it('CSV приходит архивом zip, JSON — документом json', () => {
    expect(exportFileExtension('csv')).toBe('zip');
    expect(exportFileExtension('json')).toBe('json');
  });
});
