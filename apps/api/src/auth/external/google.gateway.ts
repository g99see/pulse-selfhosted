// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Google OAuth2/OIDC — authorization code + PKCE (ТЗ §7). Реализовано на
 * глобальном fetch без тяжёлых SDK. Эндпоинты Google вынесены за интерфейс
 * GoogleOAuthGateway, поэтому в тестах подменяется фейком и реальных запросов
 * к Google не происходит.
 */
import { Injectable } from '@nestjs/common';
import { verifyGoogleIdToken, type GoogleIdTokenClaims, type RsaJwk } from './google.tokens';

export interface GoogleAuthUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

export interface GoogleCodeExchangeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}

export interface GoogleOAuthGateway {
  buildAuthUrl(input: GoogleAuthUrlInput): string;
  exchangeCode(input: GoogleCodeExchangeInput): Promise<{ idToken: string }>;
  verifyIdToken(idToken: string, clientId: string): Promise<GoogleIdTokenClaims>;
}

/** Токен DI: в тестах подменяется фейковым шлюзом. */
export const GOOGLE_OAUTH_GATEWAY = Symbol('GOOGLE_OAUTH_GATEWAY');

const GOOGLE_SCOPES = 'openid email profile';
const DEFAULT_JWKS_TTL_SECONDS = 3600;

@Injectable()
export class GoogleOAuthClient implements GoogleOAuthGateway {
  private readonly authEndpoint =
    process.env.GOOGLE_AUTH_ENDPOINT ?? 'https://accounts.google.com/o/oauth2/v2/auth';
  private readonly tokenEndpoint =
    process.env.GOOGLE_TOKEN_ENDPOINT ?? 'https://oauth2.googleapis.com/token';
  private readonly jwksEndpoint =
    process.env.GOOGLE_JWKS_URL ?? 'https://www.googleapis.com/oauth2/v3/certs';

  private cache: { keys: RsaJwk[]; expiresAt: number } | null = null;

  buildAuthUrl({ clientId, redirectUri, state, codeChallenge }: GoogleAuthUrlInput): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'online',
      prompt: 'select_account',
    });
    return `${this.authEndpoint}?${params.toString()}`;
  }

  async exchangeCode(input: GoogleCodeExchangeInput): Promise<{ idToken: string }> {
    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        code: input.code,
        code_verifier: input.codeVerifier,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Google token endpoint вернул ${response.status}`);
    }

    const body = (await response.json()) as { id_token?: unknown };
    if (typeof body.id_token !== 'string') {
      throw new Error('Google не вернул id_token');
    }
    return { idToken: body.id_token };
  }

  async verifyIdToken(idToken: string, clientId: string): Promise<GoogleIdTokenClaims> {
    const jwks = await this.fetchJwks();
    return verifyGoogleIdToken(idToken, { jwks, clientId });
  }

  private async fetchJwks(): Promise<RsaJwk[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.keys;

    const response = await fetch(this.jwksEndpoint, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Google JWKS вернул ${response.status}`);
    }

    const body = (await response.json()) as { keys?: unknown };
    const keys = Array.isArray(body.keys) ? (body.keys as RsaJwk[]) : [];
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1]);
    const ttl = Number.isFinite(maxAge) && maxAge > 0 ? maxAge : DEFAULT_JWKS_TTL_SECONDS;

    this.cache = { keys, expiresAt: Date.now() + ttl * 1000 };
    return keys;
  }
}
