#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Проверка лицензий зависимостей (ТЗ §10): в проект допускаются только
 * совместимые с AGPL-3.0-or-later лицензии. Работает через `pnpm licenses`,
 * поэтому корректно обходит симлинки pnpm и монорепо.
 *
 * Запуск: pnpm license:check
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Разрешённые лицензии (в том числе SPDX-выражения целиком). */
const ALLOWED = new Set([
  '0BSD',
  'MIT',
  'MIT-0',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
  'OFL-1.1',
  'PostgreSQL',
  'Python-2.0',
  'MPL-2.0',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'GPL-3.0-or-later',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  '(MIT OR CC0-1.0)',
  '(MIT OR Apache-2.0)',
  '(Apache-2.0 AND MIT)',
  '(BSD-2-Clause OR MIT OR Apache-2.0)',
]);

/** Разворачивает простое SPDX-выражение в набор атомов. */
function atoms(expression) {
  return expression
    .replace(/[()]/g, ' ')
    .split(/\s+(?:AND|OR|WITH)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isAllowed(expression) {
  if (typeof expression !== 'string' || expression.length === 0) return false;
  if (ALLOWED.has(expression)) return true;
  const parts = atoms(expression);
  return parts.length > 0 && parts.every((part) => ALLOWED.has(part));
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let raw;
try {
  raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (error) {
  console.error('license:check — не удалось получить список лицензий через pnpm.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const buckets = JSON.parse(raw);
const violations = [];
let checked = 0;
const summary = [];

for (const [license, packages] of Object.entries(buckets)) {
  summary.push(`${license} × ${packages.length}`);
  for (const pkg of packages) {
    checked += 1;
    if (!isAllowed(license)) {
      violations.push(`  ✖ ${pkg.name}@${(pkg.versions ?? []).join(', ') || '?'} — ${license}`);
    }
  }
}

console.log(`license:check — проверено ${checked} production-зависимостей.`);
console.log(`Лицензии: ${summary.sort().join(', ')}`);

if (violations.length > 0) {
  console.error(`\nНайдены несовместимые лицензии (${violations.length}):`);
  console.error(violations.join('\n'));
  console.error(
    '\nДопустимы MIT/MIT-0, Apache-2.0, BSD, ISC, 0BSD, MPL-2.0, LGPL/GPL/AGPL, OFL, PostgreSQL License.',
  );
  process.exit(1);
}

console.log('Все лицензии совместимы с AGPL-3.0-or-later.');
