// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Подгружает apps/api/.env, не перезатирая уже заданные переменные. */
export function loadBaseEnv(): void {
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

/**
 * Отдельная схема для интеграционных тестов (ТЗ: тесты против реального
 * dev-Postgres, но не по «боевым» данным).
 */
export function testDatabaseUrl(): string {
  loadBaseEnv();
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
  if (base.length === 0) {
    throw new Error('DATABASE_URL не задан — интеграционные тесты требуют PostgreSQL');
  }
  const url = new URL(base);
  url.searchParams.set('schema', 'puls_test');
  return url.toString();
}

/** Переменные окружения для тестового процесса. */
export function testEnv(): Record<string, string> {
  return {
    DATABASE_URL: testDatabaseUrl(),
    RATE_LIMIT_STORE: 'memory',
    MAIL_TRANSPORT: 'console',
    WEB_APP_URL: 'http://localhost:3000',
    ARGON2_MEMORY_COST: '4096',
    ARGON2_TIME_COST: '1',
    ARGON2_PARALLELISM: '1',
    NODE_ENV: 'test',
    API_PORT: '3001',
    CORS_ORIGIN: 'http://localhost:3000',
  };
}
