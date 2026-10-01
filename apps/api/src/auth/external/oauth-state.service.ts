// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Состояние OAuth-потока: `state` и PKCE (ТЗ §7, §6). Живёт на сервере с TTL
 * (Valkey в продакшене, в памяти процесса — в тестах) и удаляется при первом
 * использовании, поэтому повторный callback с тем же `state` отклоняется.
 * Дополнительно `state` кладётся в подписанную httpOnly-cookie, привязывая
 * поток к браузеру пользователя.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import Redis from 'ioredis';

export type OAuthIntent = 'login' | 'link';

export interface OAuthStatePayload {
  intent: OAuthIntent;
  userId?: string;
  codeVerifier: string;
  createdAt: number;
}

export interface OAuthStateStore {
  save(state: string, payload: OAuthStatePayload, ttlSeconds: number): Promise<void>;
  take(state: string): Promise<OAuthStatePayload | null>;
}

/** Время жизни state и code_verifier (секунды). */
export const OAUTH_STATE_TTL_SECONDS = Number(process.env.OAUTH_STATE_TTL_SECONDS ?? 600);

/** PKCE S256: base64url(SHA-256(verifier)). */
export function pkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

/** 32 случайных байта — и state, и code_verifier. */
export function randomUrlToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Хранилище в памяти процесса с часовым механизмом для тестов. */
export class MemoryOAuthStateStore implements OAuthStateStore {
  private readonly entries = new Map<string, { payload: OAuthStatePayload; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get size(): number {
    return this.entries.size;
  }

  async save(state: string, payload: OAuthStatePayload, ttlSeconds: number): Promise<void> {
    this.entries.set(state, { payload, expiresAt: this.now() + ttlSeconds * 1000 });
  }

  async take(state: string): Promise<OAuthStatePayload | null> {
    const entry = this.entries.get(state);
    if (!entry) return null;
    this.entries.delete(state);
    if (entry.expiresAt <= this.now()) return null;
    return entry.payload;
  }
}

/** Хранилище на Valkey/Redis: переживает перезапуск и общее для инстансов. */
export class ValkeyOAuthStateStore implements OAuthStateStore {
  constructor(private readonly redis: Redis) {}

  async save(state: string, payload: OAuthStatePayload, ttlSeconds: number): Promise<void> {
    await this.redis.set(`puls:oauth:${state}`, JSON.stringify(payload), 'EX', Math.max(1, ttlSeconds));
  }

  /** GETDEL недоступен на старых серверах — берём и удаляем. */
  async take(state: string): Promise<OAuthStatePayload | null> {
    const key = `puls:oauth:${state}`;
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    await this.redis.del(key);
    try {
      return JSON.parse(raw) as OAuthStatePayload;
    } catch {
      return null;
    }
  }
}

@Injectable()
export class OAuthStateService implements OnModuleDestroy {
  private readonly logger = new Logger(OAuthStateService.name);
  private readonly memory = new MemoryOAuthStateStore();
  private readonly redisUrl = process.env.REDIS_URL ?? '';
  private store: OAuthStateStore = this.memory;
  private redis: Redis | null = null;

  constructor() {
    // В тестах всегда память: не зависим от живого Valkey.
    const useValkey = process.env.NODE_ENV !== 'test' && this.redisUrl.length > 0;
    if (!useValkey) return;

    this.redis = new Redis(this.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    this.redis.on('error', () => undefined);
    this.store = new ValkeyOAuthStateStore(this.redis);
    void this.redis.connect().catch((error: unknown) => {
      this.logger.warn(
        `Valkey недоступен для state OAuth (${
          error instanceof Error ? error.message : 'unknown'
        }), остаёмся в памяти`,
      );
      this.redis?.disconnect();
      this.redis = null;
      this.store = this.memory;
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.redis?.disconnect();
    this.redis = null;
  }

  /** Выдаёт state и PKCE-пару, сохраняя code_verifier под state до первого использования. */
  async issue(
    intent: OAuthIntent,
    userId?: string,
  ): Promise<{ state: string; codeVerifier: string; codeChallenge: string }> {
    const state = randomUrlToken();
    const codeVerifier = randomUrlToken();
    await this.store.save(
      state,
      { intent, userId, codeVerifier, createdAt: Date.now() },
      OAUTH_STATE_TTL_SECONDS,
    );
    return { state, codeVerifier, codeChallenge: pkceChallenge(codeVerifier) };
  }

  /** Забирает и удаляет состояние: повторное использование вернёт null. */
  take(state: string): Promise<OAuthStatePayload | null> {
    return this.store.take(state);
  }
}
