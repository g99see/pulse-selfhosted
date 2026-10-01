// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['src/app', 'src/components'];
const CYRILLIC = /[\u0400-\u04FF]/;

/** Убирает комментарии, чтобы русские пояснения в коде не считались строками UI. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collect(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('локализация экранов (ТЗ §6)', () => {
  it('не содержит зашитых русских строк в страницах и компонентах', () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of collect(root)) {
        const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
        lines.forEach((line, index) => {
          if (CYRILLIC.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        });
      }
    }

    expect(offenders, `Строки должны идти через t():\n${offenders.join('\n')}`).toEqual([]);
  });
});
