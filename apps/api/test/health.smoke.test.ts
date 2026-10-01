// SPDX-License-Identifier: AGPL-3.0-or-later
// Smoke-тест: поднимает настоящее приложение Nest и проверяет /health против
// живого PostgreSQL. Запуск: pnpm --filter @puls/api test:smoke
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

describe('GET /health (smoke)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('отвечает 200 и подтверждает подключение к PostgreSQL', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', db: 'up' });
    expect(typeof response.body.version).toBe('string');
  });
});
