// SPDX-License-Identifier: AGPL-3.0-or-later
import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { httpError } from '../common/http-error';
import { HtmlPageService } from './html-page.service';

/**
 * Строгая CSP для пользовательского домена (ТЗ §3.8, §6): без внешних скриптов,
 * без форм на сторонние адреса, без base и без авторедиректов. frame-ancestors
 * разрешает встраивание только основным домен.
 */
export function sandboxCsp(mainDomain: string, publicOrigin = process.env.PUBLIC_ORIGIN): string {
  const host = mainDomain.trim() || 'localhost';
  const anchoredToHttp = host.startsWith('localhost') || host.startsWith('127.');
  // PUBLIC_ORIGIN (точный origin основного сайта) приоритетнее: так работает http://IP.
  const exact = publicOrigin?.trim().replace(/\/+$/, '');
  const origin = exact || `${anchoredToHttp ? 'http' : 'https'}://${host}`;
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline' https:",
    'img-src https: data:',
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${origin}`,
  ].join('; ');
}

/**
 * Публичная отдача пользовательского HTML с отдельного домена песочницы
 * (ТЗ §3.8, §6). Отдаётся только опубликованное и разрешённое владельцем;
 * cookie основного сайта не читаются и не выставляются.
 *
 * Путь вне префикса /api (см. app.setup.ts): Caddy проксирует сюда только
 * /sandbox/* на домене SANDBOX_DOMAIN.
 */
@Controller('sandbox')
export class SandboxController {
  constructor(private readonly pages: HtmlPageService) {}

  @Get(':nickname')
  async page(@Param('nickname') nickname: string, @Res() res: Response): Promise<void> {
    const resolved = await this.pages.resolvePublished(nickname);
    if (!resolved) {
      throw httpError(404, 'page_not_found', 'Страница не найдена или не опубликована');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', sandboxCsp(process.env.DOMAIN ?? 'localhost'));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    // Cookie основного сайта сюда не попадают и не выставляются.
    res.send(resolved.html);
  }
}
