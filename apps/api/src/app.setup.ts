// SPDX-License-Identifier: AGPL-3.0-or-later
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';

/**
 * Общая настройка приложения для main.ts и тестов: префикс /api (кроме /health),
 * CORS с cookie, разбор cookie и доверие одному прокси (Caddy впереди).
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api', { exclude: ['health'] });

  // За обратным прокси реальный IP клиента приходит в X-Forwarded-For.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.use(cookieParser());

  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });
}
