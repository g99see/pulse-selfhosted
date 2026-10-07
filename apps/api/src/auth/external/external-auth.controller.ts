// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Эндпоинты внешнего входа (ТЗ §3.1, §7): Google OAuth2/OIDC с PKCE (вход через
 * Telegram удалён в v3 §7.3). Без ключей владельца провайдер выключен: `GET /api/auth/providers`
 * сообщает только о включённых, а сами эндпоинты отвечают 404 provider_disabled.
 * `state` хранится на сервере с TTL и в httpOnly-cookie — повторное использование
 * отклоняется, коллбэк привязан к браузеру.
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { ExternalProviderSchema } from '@puls/shared';
import { cookieSecure } from '../../common/cookie-secure';
import { httpError } from '../../common/http-error';
import type { AuthenticatedRequest } from '../auth.types';
import { clearCookieOptions, SESSION_COOKIE, sessionCookieOptions } from '../cookies';
import { SessionGuard } from '../session.guard';
import type { SessionContext } from '../session.service';
import { constantTimeEqual } from '../tokens';
import { ExternalAuthService } from './external-auth.service';
import { GOOGLE_OAUTH_GATEWAY, type GoogleOAuthGateway } from './google.gateway';
import {
  OAuthStateService,
  OAUTH_STATE_TTL_SECONDS,
  type OAuthIntent,
} from './oauth-state.service';
import { googleConfig, providerAvailability, type GoogleConfig } from './providers';

/** httpOnly-cookie со state: JS её не читает и подделать не может. */
export const OAUTH_STATE_COOKIE = 'puls_oauth_state';

function secureCookies(): boolean {
  return cookieSecure();
}

function stateCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    path: '/',
    maxAge: OAUTH_STATE_TTL_SECONDS * 1000,
  };
}

@Controller('auth')
export class ExternalAuthController {
  private readonly webAppUrl = (process.env.WEB_APP_URL ?? 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );
  private readonly configuredRedirectUri = process.env.GOOGLE_REDIRECT_URI ?? '';

  constructor(
    private readonly external: ExternalAuthService,
    private readonly state: OAuthStateService,
    @Inject(GOOGLE_OAUTH_GATEWAY) private readonly google: GoogleOAuthGateway,
  ) {}

  /** Что включил владелец — web рисует только эти кнопки (ТЗ §3.1). */
  @Get('providers')
  providers(): { google: boolean } {
    return providerAvailability();
  }

  @Get('google/start')
  async googleStart(@Req() req: Request, @Res() res: Response): Promise<void> {
    const config = googleConfig();
    if (!config)
      throw httpError(404, 'provider_disabled', 'Вход через Google не настроен на этом сервере');

    await this.beginGoogle(req, res, config, 'login');
  }

  @Get('link/google/start')
  @UseGuards(SessionGuard)
  async linkGoogleStart(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const config = googleConfig();
    if (!config)
      throw httpError(404, 'provider_disabled', 'Вход через Google не настроен на этом сервере');

    await this.beginGoogle(req, res, config, 'link', req.user!.id);
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const config = googleConfig();
    if (!config)
      throw httpError(404, 'provider_disabled', 'Вход через Google не настроен на этом сервере');

    const failed = (reason: string): void => {
      res.redirect(`${this.webAppUrl}/login?error=${reason}`);
    };

    if (error) return failed('oauth_cancelled');

    const cookieState = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
    if (!code || !state || !cookieState || !constantTimeEqual(String(state), String(cookieState))) {
      return failed('oauth_state');
    }

    const payload = await this.state.take(String(state));
    if (!payload) return failed('oauth_state');

    res.clearCookie(OAUTH_STATE_COOKIE, clearCookieOptions());

    let idToken: string;
    try {
      ({ idToken } = await this.google.exchangeCode({
        code: String(code),
        codeVerifier: payload.codeVerifier,
        redirectUri: this.redirectUri(req),
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      }));
    } catch {
      return failed('oauth_exchange');
    }

    let claims;
    try {
      claims = await this.google.verifyIdToken(idToken, config.clientId);
    } catch {
      return failed('oauth_token');
    }

    if (payload.intent === 'link' && payload.userId) {
      try {
        await this.external.linkGoogleIdentity(payload.userId, claims);
      } catch {
        return res.redirect(`${this.webAppUrl}/settings?error=link_failed`);
      }
      return res.redirect(`${this.webAppUrl}/settings?linked=google`);
    }

    const { user, token, expiresAt } = await this.external.loginWithGoogle(claims, contextOf(req));
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return res.redirect(`${this.webAppUrl}${user.onboardingCompletedAt ? '/app' : '/onboarding'}`);
  }

  @Get('identities')
  @UseGuards(SessionGuard)
  identities(@Req() req: AuthenticatedRequest) {
    return this.external.listIdentities(req.user!.id);
  }

  @Delete('identities/:provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  async unlink(
    @Param('provider') provider: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const parsed = ExternalProviderSchema.safeParse(provider);
    if (!parsed.success) throw httpError(404, 'identity_not_found', 'Неизвестный способ входа');

    await this.external.unlinkIdentity(req.user!.id, parsed.data);
  }

  private async beginGoogle(
    req: Request,
    res: Response,
    config: GoogleConfig,
    intent: OAuthIntent,
    userId?: string,
  ): Promise<void> {
    const { state, codeChallenge } = await this.state.issue(intent, userId);
    res.cookie(OAUTH_STATE_COOKIE, state, stateCookieOptions());
    res.redirect(
      this.google.buildAuthUrl({
        clientId: config.clientId,
        redirectUri: this.redirectUri(req),
        state,
        codeChallenge,
      }),
    );
  }

  private redirectUri(req: Request): string {
    if (this.configuredRedirectUri) return this.configuredRedirectUri;
    const proto = req.protocol || 'http';
    const host = req.get('host') ?? `localhost:${process.env.API_PORT ?? 3001}`;
    return `${proto}://${host}/api/auth/google/callback`;
  }
}

function contextOf(req: Request): SessionContext {
  const userAgent = req.headers['user-agent'];
  return {
    userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
    ip: req.ip,
  };
}
