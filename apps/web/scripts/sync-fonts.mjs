#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Копирует woff2 из @fontsource-variable в apps/web/public/fonts (ТЗ §8).
 * Шрифты Unbounded и Onest self-hosted: внешних запросов к fonts.googleapis.com
 * приложение не делает, сборка работает офлайн.
 *
 * Запуск: pnpm --filter @puls/web fonts:sync
 */
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(webRoot, 'public', 'fonts');

/** Файлы, которые нужны интерфейсу: кириллица + латиница для обоих семейств (Unbounded — заголовки и крупные числа, Onest — текст). */
const FILES = [
  ['@fontsource-variable/onest', 'onest-cyrillic-wght-normal.woff2'],
  ['@fontsource-variable/onest', 'onest-latin-wght-normal.woff2'],
  ['@fontsource-variable/unbounded', 'unbounded-cyrillic-wght-normal.woff2'],
  ['@fontsource-variable/unbounded', 'unbounded-latin-wght-normal.woff2'],
];

mkdirSync(target, { recursive: true });

for (const [pkg, file] of FILES) {
  const from = join(webRoot, 'node_modules', pkg, 'files', file);
  copyFileSync(from, join(target, file));
  console.log(`fonts:sync — ${pkg}/${file}`);
}
