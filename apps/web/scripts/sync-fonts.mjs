#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Копирует woff2 из @fontsource-variable в apps/web/public/fonts (ТЗ §8).
 * Шрифты Manrope и Inter self-hosted: внешних запросов к fonts.googleapis.com
 * приложение не делает, сборка работает офлайн.
 *
 * Запуск: pnpm --filter @puls/web fonts:sync
 */
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(webRoot, 'public', 'fonts');

/** Файлы, которые нужны интерфейсу: кириллица + латиница для обоих семейств. */
const FILES = [
  ['@fontsource-variable/inter', 'inter-cyrillic-wght-normal.woff2'],
  ['@fontsource-variable/inter', 'inter-latin-wght-normal.woff2'],
  ['@fontsource-variable/manrope', 'manrope-cyrillic-wght-normal.woff2'],
  ['@fontsource-variable/manrope', 'manrope-latin-wght-normal.woff2'],
];

mkdirSync(target, { recursive: true });

for (const [pkg, file] of FILES) {
  const from = join(webRoot, 'node_modules', pkg, 'files', file);
  copyFileSync(from, join(target, file));
  console.log(`fonts:sync — ${pkg}/${file}`);
}
