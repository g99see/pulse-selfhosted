// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { AuthApiError, csrfHeader, parseAuthError, readCsrfCookie } from '../src/lib/auth-client';

describe('readCsrfCookie', () => {
  it('extracts the value from a cookie string', () => {
    expect(readCsrfCookie('a=1; puls_csrf=TOKEN123; b=2')).toBe('TOKEN123');
  });

  it('returns undefined when the cookie is absent', () => {
    expect(readCsrfCookie('a=1; b=2')).toBeUndefined();
    expect(readCsrfCookie('')).toBeUndefined();
  });
});

describe('csrfHeader', () => {
  it('builds the X-CSRF-Token header for mutating requests', () => {
    expect(csrfHeader('TOKEN')).toEqual({ 'X-CSRF-Token': 'TOKEN' });
  });

  it('is empty without a token', () => {
    expect(csrfHeader(undefined)).toEqual({});
  });
});

describe('parseAuthError', () => {
  it('reads code and message from the API error body', async () => {
    const response = new Response(JSON.stringify({ code: 'email_taken', message: 'Email занят' }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });

    const error = await parseAuthError(response);

    expect(error).toBeInstanceOf(AuthApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe('email_taken');
    expect(error.message).toBe('Email занят');
  });

  it('falls back to a generic error for a non-JSON body', async () => {
    const response = new Response('boom', { status: 500 });

    const error = await parseAuthError(response);

    expect(error.status).toBe(500);
    expect(error.code).toBe('unknown_error');
    expect(error.message.length).toBeGreaterThan(0);
  });
});
