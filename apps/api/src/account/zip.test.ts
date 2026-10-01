// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты минимального ZIP-писателя (метод STORE) для выгрузки CSV.
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createZip } from './zip';

interface ParsedEntry {
  name: string;
  data: Buffer;
  crc: number;
}

/** Разбор архива по локальным заголовкам — проверяем, что ZIP читается. */
function parseLocalEntries(buffer: Buffer): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  let offset = 0;

  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const crc = buffer.readUInt32LE(offset + 14);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extraLength;
    entries.push({ name, data: buffer.subarray(dataStart, dataStart + size), crc });
    offset = dataStart + size;
  }

  return entries;
}

describe('createZip', () => {
  it('пишет архив STORE с корректными именами, содержимым и CRC', () => {
    const zip = createZip([
      { name: 'accounts.csv', content: 'id,name\r\na1,Карта\r\n' },
      { name: 'users.csv', content: 'email\r\nme@example.com\r\n' },
    ]);

    expect(zip.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');

    const entries = parseLocalEntries(zip);
    expect(entries.map((entry) => entry.name)).toEqual(['accounts.csv', 'users.csv']);
    expect(entries[0].data.toString('utf8')).toBe('id,name\r\na1,Карта\r\n');
    expect(entries[1].data.toString('utf8')).toBe('email\r\nme@example.com\r\n');

    for (const entry of entries) {
      expect(entry.crc >>> 0).toBe(crc32(entry.data) >>> 0);
    }
  });

  it('завершает архив центральным каталогом и EOCD', () => {
    const zip = createZip([{ name: 'a.csv', content: 'x' }]);

    const eocdOffset = zip.length - 22;
    expect(zip.readUInt32LE(eocdOffset)).toBe(0x06054b50);
    expect(zip.readUInt16LE(eocdOffset + 8)).toBe(1);
    expect(zip.readUInt16LE(eocdOffset + 10)).toBe(1);

    const centralOffset = zip.readUInt32LE(eocdOffset + 16);
    expect(zip.readUInt32LE(centralOffset)).toBe(0x02014b50);
    expect(zip.readUInt32LE(zip.length - 22 + 12)).toBe(zip.length - 22 - centralOffset);
  });

  it('пишет пустой архив без файлов', () => {
    const zip = createZip([]);
    expect(zip.length).toBe(22);
    expect(zip.readUInt32LE(0)).toBe(0x06054b50);
    expect(zip.readUInt16LE(10)).toBe(0);
  });

  it('помечает имена как UTF-8 (флаг 0x0800)', () => {
    const zip = createZip([{ name: 'чек-ины.csv', content: 'x' }]);
    expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800);
    expect(parseLocalEntries(zip)[0].name).toBe('чек-ины.csv');
  });
});
