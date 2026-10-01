// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты верификации Google id_token по JWKS (ТЗ §7): подпись RS256,
// издатель, аудитория и срок действия. Реальный Google здесь не нужен —
// ключи генерируются локально, как это делала бы страница JWKS.
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  GoogleTokenError,
  decodeJwtSegment,
  verifyGoogleIdToken,
  type RsaJwk,
} from './google.tokens';

const CLIENT_ID = 'puls-test.apps.googleusercontent.com';
const NOW = 1_700_000_000; // секунды

let privateKey: KeyObject;
let kms: RsaJwk[];

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signToken(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', kid: 'key-1', typ: 'JWT' },
): string {
  const head = base64url(JSON.stringify(header));
  const body = base64url(JSON.stringify(payload));
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey);
  return `${head}.${body}.${base64url(signature)}`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    azp: CLIENT_ID,
    aud: CLIENT_ID,
    sub: 'google-subject-1',
    email: 'someone@gmail.com',
    email_verified: true,
    iat: NOW - 10,
    exp: NOW + 3600,
    name: 'Someone',
    ...overrides,
  };
}

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  const jwk = pair.publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string };
  kms = [{ kty: 'RSA', kid: 'key-1', use: 'sig', alg: 'RS256', n: jwk.n, e: jwk.e }];
});

describe('decodeJwtSegment', () => {
  it('декодирует base64url JSON', () => {
    expect(decodeJwtSegment(base64url('{"a":1}'))).toEqual({ a: 1 });
  });
});

describe('verifyGoogleIdToken', () => {
  it('принимает корректный токен и отдаёт claims', () => {
    const token = signToken(validClaims());
    const claims = verifyGoogleIdToken(token, { jwks: kms, clientId: CLIENT_ID, now: NOW });

    expect(claims.sub).toBe('google-subject-1');
    expect(claims.email).toBe('someone@gmail.com');
    expect(claims.email_verified).toBe(true);
  });

  it('принимает издателя accounts.google.com без схемы', () => {
    const token = signToken(validClaims({ iss: 'accounts.google.com' }));
    expect(verifyGoogleIdToken(token, { jwks: kms, clientId: CLIENT_ID, now: NOW }).sub).toBe(
      'google-subject-1',
    );
  });

  it('отклоняет подпись, подделанную другим ключом', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const head = base64url(JSON.stringify({ alg: 'RS256', kid: 'key-1' }));
    const body = base64url(JSON.stringify(validClaims()));
    const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(other.privateKey);
    const token = `${head}.${body}.${base64url(signature)}`;

    expect(() => verifyGoogleIdToken(token, { jwks: kms, clientId: CLIENT_ID, now: NOW })).toThrow(
      GoogleTokenError,
    );
  });

  it('отклоняет изменённые claims', () => {
    const token = signToken(validClaims());
    const [head] = token.split('.');
    const forgedBody = base64url(JSON.stringify(validClaims({ sub: 'attacker' })));
    const parts = token.split('.');
    expect(() =>
      verifyGoogleIdToken(`${head}.${forgedBody}.${parts[2]}`, {
        jwks: kms,
        clientId: CLIENT_ID,
        now: NOW,
      }),
    ).toThrow(GoogleTokenError);
  });

  it('отклоняет чужую аудиторию', () => {
    const token = signToken(validClaims({ aud: 'other-client' }));
    expect(() => verifyGoogleIdToken(token, { jwks: kms, clientId: CLIENT_ID, now: NOW })).toThrow(
      /аудитор/,
    );
  });

  it('отклоняет истёкший токен', () => {
    const token = signToken(validClaims({ exp: NOW - 1 }));
    expect(() => verifyGoogleIdToken(token, { jwks: kms, clientId: CLIENT_ID, now: NOW })).toThrow(
      /истёк/,
    );
  });

  it('отклоняет чужого издателя', () => {
    const token = signToken(validClaims({ iss: 'https://evil.example' }));
    expect(() => verifyGoogleIdToken(token, { jwks: kms, clientId: CLIENT_ID, now: NOW })).toThrow(
      /издател/,
    );
  });

  it('отклоняет неизвестный kid', () => {
    const token = signToken(validClaims(), { alg: 'RS256', kid: 'missing', typ: 'JWT' });
    expect(() => verifyGoogleIdToken(token, { jwks: kms, clientId: CLIENT_ID, now: NOW })).toThrow(
      /ключ/,
    );
  });

  it('отклоняет alg=none', () => {
    const head = base64url(JSON.stringify({ alg: 'none', kid: 'key-1' }));
    const body = base64url(JSON.stringify(validClaims()));
    expect(() =>
      verifyGoogleIdToken(`${head}.${body}.`, { jwks: kms, clientId: CLIENT_ID, now: NOW }),
    ).toThrow(GoogleTokenError);
  });

  it('отклоняет строку не из трёх частей', () => {
    expect(() =>
      verifyGoogleIdToken('not-a-jwt', { jwks: kms, clientId: CLIENT_ID, now: NOW }),
    ).toThrow(GoogleTokenError);
  });

  it('отклоняет claims из будущего (iat)', () => {
    const token = signToken(validClaims({ iat: NOW + 600 }));
    expect(() => verifyGoogleIdToken(token, { jwks: kms, clientId: CLIENT_ID, now: NOW })).toThrow(
      GoogleTokenError,
    );
  });
});
