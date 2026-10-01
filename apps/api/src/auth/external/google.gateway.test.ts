// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты сборки URL согласия Google (ТЗ §7): PKCE S256, state, scope.
// Сетевых вызовов нет — проверяется только формирование ссылки.
import { describe, expect, it } from 'vitest';
import { GoogleOAuthClient } from './google.gateway';

describe('GoogleOAuthClient.buildAuthUrl', () => {
  it('формирует ссылку с PKCE S256 и openid-скоупом', () => {
    const client = new GoogleOAuthClient();
    const url = new URL(
      client.buildAuthUrl({
        clientId: 'client-id',
        redirectUri: 'http://localhost:3001/api/auth/google/callback',
        state: 'the-state',
        codeChallenge: 'the-challenge',
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3001/api/auth/google/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('the-state');
    expect(url.searchParams.get('code_challenge')).toBe('the-challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});
