// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * AES-256-GCM «сейф» для секретов (ТЗ §6): AI-ключи и токены.
 *
 * Мастер-ключ берётся из APP_ENCRYPTION_KEY (32 байта в base64). В production
 * без ключа сейф недоступен — 2FA явно выключена, а не «наполовину работает».
 * В dev/test, чтобы не блокировать разработку, используется явный тестовый
 * ключ DEV_TEST_KEY_BASE64 (он небезопасен и только для не-production).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { httpError } from '../common/http-error';

export const SECRET_BOX_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** Явный dev/test-ключ. Выводится детерминированно — не для production. */
export const DEV_TEST_KEY_BASE64 = createHash('sha256')
  .update('puls-insecure-development-only-2fa-key')
  .digest('base64');

export type MasterKeySource = 'env' | 'dev' | 'unavailable';

export interface MasterKeyResolution {
  keyBase64: string | null;
  source: MasterKeySource;
}

function decodeKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error('APP_ENCRYPTION_KEY должен быть 32 байта в base64');
  }
  return key;
}

/** Решает, каким ключом шифровать; в production без ключа — unavailable. */
export function resolveMasterKey(env: NodeJS.ProcessEnv = process.env): MasterKeyResolution {
  const provided = env.APP_ENCRYPTION_KEY?.trim();
  if (provided) {
    decodeKey(provided); // проверяем длину сразу, чтобы упасть при старте
    return { keyBase64: provided, source: 'env' };
  }
  if (env.NODE_ENV === 'production') {
    return { keyBase64: null, source: 'unavailable' };
  }
  return { keyBase64: DEV_TEST_KEY_BASE64, source: 'dev' };
}

/** Формат: `v1.<iv>.<tag>.<ciphertext>` в base64url. */
export class SecretBox {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    this.key = decodeKey(keyBase64);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      SECRET_BOX_VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== SECRET_BOX_VERSION) {
      throw new Error('Некорректный формат секрета');
    }

    const [, ivPart, tagPart, dataPart] = parts;
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

export function createSecretBox(masterKeyBase64: string): SecretBox {
  return new SecretBox(masterKeyBase64);
}

/** Nest-провайдер без аргументов конструктора (DI): читает env в полях. */
@Injectable()
export class SecretBoxService {
  private readonly resolution = resolveMasterKey();
  private readonly box: SecretBox | null = this.resolution.keyBase64
    ? new SecretBox(this.resolution.keyBase64)
    : null;

  get available(): boolean {
    return this.box !== null;
  }

  get source(): MasterKeySource {
    return this.resolution.source;
  }

  encrypt(plaintext: string): string {
    if (!this.box) throw this.unavailable();
    return this.box.encrypt(plaintext);
  }

  decrypt(payload: string): string {
    if (!this.box) throw this.unavailable();
    return this.box.decrypt(payload);
  }

  private unavailable(): Error {
    return httpError(
      503,
      'encryption_unavailable',
      'Шифрование недоступно: не задан APP_ENCRYPTION_KEY',
    );
  }
}
