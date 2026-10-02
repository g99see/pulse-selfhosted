// SPDX-License-Identifier: AGPL-3.0-or-later
import { Controller, Get, Res } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Response } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { configureApp } from './app.setup';

@Controller('t')
class CookieController {
  @Get('set')
  set(@Res() res: Response) {
    res.cookie('a', '1', { httpOnly: true, secure: false });
    res.clearCookie('b', { secure: false });
    res.send('ok');
  }
}

async function appWith(mode: string | undefined): Promise<INestApplication> {
  if (mode === undefined) delete process.env.COOKIE_SECURE;
  else process.env.COOKIE_SECURE = mode;
  const moduleRef = await Test.createTestingModule({ controllers: [CookieController] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

describe('COOKIE_SECURE=auto', () => {
  const saved = process.env.COOKIE_SECURE;
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    if (saved === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = saved;
  });

  it('Secure по X-Forwarded-Proto: https, без него — нет', async () => {
    app = await appWith('auto');
    const https = await request(app.getHttpServer())
      .get('/api/t/set')
      .set('X-Forwarded-Proto', 'https');
    expect(
      (https.headers['set-cookie'] as unknown as string[]).every((c) => /;\s*Secure/i.test(c)),
    ).toBe(true);
    const http = await request(app.getHttpServer()).get('/api/t/set');
    expect((http.headers['set-cookie'] as unknown as string[]).some((c) => /Secure/i.test(c))).toBe(
      false,
    );
  });

  it('при явном значении middleware не вмешивается', async () => {
    app = await appWith('false');
    const res = await request(app.getHttpServer())
      .get('/api/t/set')
      .set('X-Forwarded-Proto', 'https');
    expect((res.headers['set-cookie'] as unknown as string[]).some((c) => /Secure/i.test(c))).toBe(
      false,
    );
  });
});
