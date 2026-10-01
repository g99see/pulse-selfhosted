// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Smoke-тесты работают с настоящими PostgreSQL и (в перспективе) Valkey.
// DATABASE_URL берём из apps/api/.env либо из окружения CI.
const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.smoke.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Тесты пишут в одну и ту же БД — не гоняем файлы параллельно.
    fileParallelism: false,
  },
});
