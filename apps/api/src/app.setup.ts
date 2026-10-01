// SPDX-License-Identifier: AGPL-3.0-or-later
import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { json } from 'express';

/**
 * Общая настройка приложения для main.ts и тестов: префикс /api (кроме /health),
 * CORS с cookie, разбор cookie и доверие одному прокси (Caddy впереди).
 */
export function configureApp(app: INestApplication): void {
  // Публичная отдача HTML песочницы (ТЗ §3.8) живёт вне префикса /api:
  // на домене SANDBOX_DOMAIN Caddy проксирует сюда только /sandbox/*.
  app.setGlobalPrefix('api', {
    exclude: ['health', { path: 'sandbox/:nickname', method: RequestMethod.GET }],
  });

  // Импорт банковской выписки (ТЗ §3.2) присылает CSV до 2 МБ в теле JSON;
  // стандартного лимита Express (100 КБ) не хватает. Наш парсер регистрируется
  // раньше встроенного, поэтому встроенный пропускает уже прочитанное тело.
  app.use(json({ limit: '4mb' }));

  // За обратным прокси реальный IP клиента приходит в X-Forwarded-For.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.use(cookieParser());

  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  // Content-Disposition нужен web, чтобы сохранить файл выгрузки под исходным
  // именем (ТЗ §3.1): браузер не отдаёт этот заголовок JS без expose.
  app.enableCors({ origin: origins, credentials: true, exposedHeaders: ['Content-Disposition'] });
}
