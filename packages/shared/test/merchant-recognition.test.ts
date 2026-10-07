// SPDX-License-Identifier: AGPL-3.0-or-later
// Тестовая выписка (ТЗ v2 §9, критерий приёмки): доля автоматически распознанных
// операций по справочнику мировых магазинов должна быть не ниже 80%.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildImportPreview, parseCsv, type ImportRecognition } from '../src/import';
import { matchMerchant, type MerchantEntry, type MerchantEntryWithSource } from '../src/merchants';

/** Минимальный порог автоопределения из ТЗ v2 §9. */
const RECOGNITION_THRESHOLD = 0.8;

function loadWorld(): MerchantEntryWithSource[] {
  const raw = readFileSync(
    new URL('../../../apps/api/data/merchants.json', import.meta.url),
    'utf8',
  );
  const parsed = JSON.parse(raw) as { merchants: MerchantEntry[] };
  return parsed.merchants.map((entry) => ({ ...entry, source: 'world' as const }));
}

function loadStatement(): string {
  return readFileSync(new URL('./fixtures/statement-sample.csv', import.meta.url), 'utf8');
}

describe('автоопределение магазинов на тестовой выписке (ТЗ v2 §9)', () => {
  const world = loadWorld();
  const rows = parseCsv(loadStatement(), ';');

  it('справочник содержит не меньше 400 магазинов', () => {
    expect(world.length).toBeGreaterThanOrEqual(400);
  });

  it('тестовая выписка содержит не меньше 50 операций', () => {
    // Первая строка — заголовок.
    expect(rows.length - 1).toBeGreaterThanOrEqual(50);
  });

  it('распознаёт не менее 80% операций по справочнику', () => {
    const recognize = (description: string): ImportRecognition | null => {
      const match = matchMerchant(description, world);
      if (!match) return null;
      return {
        categoryId: match.entry.defaultCategory,
        categoryName: match.entry.defaultCategory,
        merchantName: match.entry.name,
      };
    };

    const preview = buildImportPreview(rows, {
      mapping: { date: 0, amount: 1, description: 2, type: 3 },
      hasHeader: true,
      recognize,
    });

    const valid = preview.filter(
      (row) => row.error === null && row.date !== null && row.amount !== null,
    );
    const recognized = valid.filter((row) => row.categoryId !== null);
    const ratio = recognized.length / valid.length;

    expect(recognized.length).toBeGreaterThan(0);
    expect(ratio).toBeGreaterThanOrEqual(RECOGNITION_THRESHOLD);
  });
});
