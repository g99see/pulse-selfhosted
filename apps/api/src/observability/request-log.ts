// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Структурные логи ошибок: идентификатор запроса и JSON-строка на каждую
 * ошибку. Тела запросов, cookie и заголовки авторизации в лог не попадают —
 * только метод, путь без query, статус и сообщение.
 */
import { randomUUID } from 'node:crypto';
import { ArgumentsHost, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { runtimeStats } from './runtime-stats';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export type RequestWithId = Request & { requestId?: string };

/** Присваивает запросу идентификатор (берёт входящий X-Request-Id, если он безопасен). */
export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export interface ErrorLogLine {
  level: 'error' | 'warn';
  time: string;
  msg: string;
  requestId: string | null;
  method: string;
  path: string;
  status: number;
  code: string | null;
  stack?: string;
}

/** Собирает строку лога ошибки (чистая функция для тестов). */
export function buildErrorLog(
  exception: unknown,
  req: { method?: string; originalUrl?: string; url?: string; requestId?: string },
  now: Date = new Date(),
): ErrorLogLine {
  const status = exception instanceof HttpException ? exception.getStatus() : 500;
  let code: string | null = null;
  if (exception instanceof HttpException) {
    const body = exception.getResponse();
    if (body !== null && typeof body === 'object' && 'code' in body) {
      code = String((body as { code: unknown }).code);
    }
  }
  const message = exception instanceof Error ? exception.message : String(exception);
  return {
    level: status >= 500 ? 'error' : 'warn',
    time: now.toISOString(),
    msg: message,
    requestId: req.requestId ?? null,
    method: req.method ?? '',
    path: (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '',
    status,
    code,
    ...(status >= 500 && exception instanceof Error && exception.stack
      ? { stack: exception.stack }
      : {}),
  };
}

/**
 * Глобальный фильтр: ответ формирует штатный BaseExceptionFilter, а мы
 * дополнительно пишем JSON-строку. Счётчик ошибок растёт только от 5xx.
 */
export class ErrorLogFilter extends BaseExceptionFilter {
  constructor(
    applicationRef: ConstructorParameters<typeof BaseExceptionFilter>[0],
    private readonly write: (line: string) => void = (line) => {
      process.stdout.write(`${line}\n`);
    },
  ) {
    super(applicationRef);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<RequestWithId>();
    const line = buildErrorLog(exception, req);
    // Ожидаемые 4xx (валидация, 401, 404) — не ошибки сервиса: пишем только 5xx.
    if (line.status >= 500) {
      runtimeStats.recordError();
      this.write(JSON.stringify(line));
    }
    super.catch(exception, host);
  }
}
