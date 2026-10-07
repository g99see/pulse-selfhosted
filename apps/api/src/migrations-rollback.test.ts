// SPDX-License-Identifier: AGPL-3.0-or-later
// У каждой v2-миграции есть down.sql, а скрипт отката безопасно разбирает аргументы.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..', '..');
const MIGRATIONS = join(ROOT, 'apps/api/prisma/migrations');
const V2 = [
  '20261002120000_import_amount_base',
  '20261006120000_notifications_v2',
  '20261006130000_checkin_full',
  '20261006140000_reconciliation',
  '20261006150000_statement_mismatch_notified',
  '20261006160000_checkin_goal',
  '20261006170000_day_summary_link',
  '20261007100000_remove_social',
];

describe('откат миграций (ТЗ v2 §8)', () => {
  it.each(V2)('%s: есть непустой down.sql', (name) => {
    const file = join(MIGRATIONS, name, 'down.sql');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8').trim().length).toBeGreaterThan(0);
  });

  it('down.sql удаляет то, что создаёт migration.sql (таблицы)', () => {
    for (const name of V2) {
      const up = readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8');
      const down = readFileSync(join(MIGRATIONS, name, 'down.sql'), 'utf8');
      for (const match of up.matchAll(/CREATE TABLE "([a-z_]+)"/g)) {
        expect(down, `${name}: нет DROP для ${match[1]}`).toContain(
          `DROP TABLE IF EXISTS "${match[1]}"`,
        );
      }
    }
  });

  it('скрипт: синтаксис sh, отказ без аргумента, от «../» и от миграции без down.sql', () => {
    const script = join(ROOT, 'scripts/migrate-rollback.sh');
    execFileSync('sh', ['-n', script]);
    expect(spawnSync('sh', [script]).status).toBe(2);
    const traversal = spawnSync('sh', [script, '../x']);
    expect(traversal.status).toBe(1);
    expect(traversal.stderr.toString()).toContain('недопустимое имя');
    const missing = spawnSync('sh', [script, '20261001114214_init']);
    expect(missing.status).toBe(1);
    expect(missing.stderr.toString()).toContain('нет down.sql');
  });
});
