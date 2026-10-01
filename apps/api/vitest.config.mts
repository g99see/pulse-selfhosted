// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Юнит-тесты рядом с исходниками + интеграционные против PostgreSQL.
    include: ['src/**/*.test.ts', 'test/**/*.integration.test.ts'],
    setupFiles: ['./test/setup-files.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Тесты пишут в одну схему БД — не гоняем файлы параллельно.
    fileParallelism: false,
    passWithNoTests: false,
  },
});
