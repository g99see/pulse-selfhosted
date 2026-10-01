#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Собирает PNG-иконки PWA из SVG (ТЗ §7). Внешние сервисы не нужны:
 * SVG лежит в public/icons, а растр делает локальный rsvg-convert (librsvg).
 * Результат коммитится, поэтому сборка приложения от скрипта не зависит.
 *
 * Запуск: pnpm --filter @puls/web icons:build
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const icons = join(webRoot, 'public', 'icons');

const JOBS = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['maskable.svg', 'maskable-512.png', 512],
  ['apple-touch.svg', 'apple-touch-icon.png', 180],
];

if (!existsSync(icons)) mkdirSync(icons, { recursive: true });

try {
  for (const [source, target, size] of JOBS) {
    execFileSync('rsvg-convert', [
      '--width',
      String(size),
      '--height',
      String(size),
      '--output',
      join(icons, target),
      join(icons, source),
    ]);
    console.log(`icons:build — ${target} (${size}×${size})`);
  }
} catch (error) {
  console.error('icons:build — нужен rsvg-convert (пакет librsvg).');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
