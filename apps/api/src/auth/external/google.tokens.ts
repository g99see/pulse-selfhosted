// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Верификация Google id_token по JWKS (ТЗ §7) без тяжёлых SDK: подпись RS256
 * проверяется через node:crypto, ключи берутся из набора JWKS Google.
 * Все проверки из рекомендаций OpenID Connect: alg, подпись, exp, iss, aud.
 */
import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';

export interface RsaJwk {
  kty: string;
  n: string;
  e: string;
  kid?: string;
  alg?: string;
  use?: string;
}

export interface GoogleIdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  [key: string]: unknown;
}

export class GoogleTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleTokenError';
  }
}

/** Оба варианта издателя, которые встречаются в токенах Google. */
export const GOOGLE_ISSUERS: readonly string[] = ['accounts.google.com', 'https://accounts.google.com'];

const SIGNATURE_ALGORITHM = 'RSA-SHA256';
/** Допустимое расхождение часов при проверке iat. */
const IAT_SKEW_SECONDS = 300;

/** Декодирует base64url-сегмент JWT в объект. */
export function decodeJwtSegment(segment: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new GoogleTokenError('Некорректный сегмент id_token');
  }
}

export interface VerifyGoogleIdTokenOptions {
  jwks: readonly RsaJwk[];
  clientId: string;
  /** Текущее время в секундах (UTC) — для тестов. */
  now?: number;
  issuer?: readonly string[];
}

/**
 * Проверяет id_token и возвращает claims. Бросает GoogleTokenError при любой
 * проблеме: чужая подпись, просроченный токен, неверный издатель или аудитория.
 */
export function verifyGoogleIdToken(
  idToken: string,
  options: VerifyGoogleIdTokenOptions,
): GoogleIdTokenClaims {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const allowedIssuers = options.issuer ?? GOOGLE_ISSUERS;

  if (typeof idToken !== 'string' || idToken.length === 0) {
    throw new GoogleTokenError('id_token отсутствует');
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new GoogleTokenError('id_token не является JWT');
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts;

  const header = decodeJwtSegment(headerSegment);
  const claims = decodeJwtSegment(payloadSegment);

  if (header.alg !== 'RS256') {
    throw new GoogleTokenError('Неподдерживаемый алгоритм подписи id_token');
  }

  const kid = typeof header.kid === 'string' ? header.kid : '';
  const jwk = options.jwks.find((candidate) => candidate.kid === kid);
  if (!jwk) {
    throw new GoogleTokenError('Не найден открытый ключ Google для id_token');
  }

  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({ key: jwk as never, format: 'jwk' });
  } catch {
    throw new GoogleTokenError('Не удалось прочитать открытый ключ Google');
  }

  const signature = Buffer.from(signatureSegment, 'base64url');
  const valid = createVerify(SIGNATURE_ALGORITHM)
    .update(`${headerSegment}.${payloadSegment}`)
    .verify(publicKey, signature);
  if (!valid) {
    throw new GoogleTokenError('Подпись id_token недействительна');
  }

  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp <= now) {
    throw new GoogleTokenError('Срок действия id_token истёк');
  }

  const iat = Number(claims.iat);
  if (Number.isFinite(iat) && iat > now + IAT_SKEW_SECONDS) {
    throw new GoogleTokenError('id_token выпущен в будущем');
  }

  const aud = claims.aud;
  const audienceMatches =
    aud === options.clientId || (Array.isArray(aud) && aud.includes(options.clientId));
  if (!audienceMatches) {
    throw new GoogleTokenError('Неверная аудитория id_token');
  }

  if (!allowedIssuers.includes(String(claims.iss))) {
    throw new GoogleTokenError('Неверный издатель id_token');
  }

  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new GoogleTokenError('id_token без subject');
  }

  return claims as GoogleIdTokenClaims;
}
