// SPDX-License-Identifier: AGPL-3.0-or-later
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { buildErrorLog } from './request-log';

describe('buildErrorLog', () => {
  const req = { method: 'POST', originalUrl: '/api/x?token=secret', requestId: 'rid-1' };

  it('500: уровень error, стек, id запроса, путь без query', () => {
    const line = buildErrorLog(new Error('boom'), req, new Date('2026-10-06T00:00:00Z'));
    expect(line).toMatchObject({
      level: 'error',
      time: '2026-10-06T00:00:00.000Z',
      msg: 'boom',
      requestId: 'rid-1',
      method: 'POST',
      path: '/api/x',
      status: 500,
      code: null,
    });
    expect(line.stack).toContain('boom');
    expect(JSON.stringify(line)).not.toContain('secret');
  });

  it('HttpException: статус и код из тела, без стека', () => {
    const line = buildErrorLog(new HttpException({ code: 'not_found', message: 'нет' }, 404), req);
    expect(line).toMatchObject({ level: 'warn', status: 404, code: 'not_found' });
    expect(line.stack).toBeUndefined();
  });
});
