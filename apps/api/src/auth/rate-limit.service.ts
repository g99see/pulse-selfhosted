// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  consume(
    key: string,
    limit: number,
    windowMs: number,
    now?: number,
  ): RateLimitResult | Promise<RateLimitResult>;
  reset(key: string): void | Promise<void>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Резервное хранилище в памяти процесса (ТЗ §6: ограничение частоты входов). */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  get size(): number {
    return this.buckets.size;
  }

  consume(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
    }

    if (bucket.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    bucket.count += 1;
    return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  prune(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  clear(): void {
    this.buckets.clear();
  }
}

/** Атомарный INCR + PEXPIRE через Lua, чтобы окно не сбивалось на гонках. */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`;

/** Хранилище на Valkey/Redis — переживает перезапуск и общее для инстансов. */
export class ValkeyRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const result = (await this.redis.eval(
      CONSUME_SCRIPT,
      1,
      `puls:rl:${key}`,
      windowMs,
    )) as [number, number];

    const count = Number(result[0]);
    const ttl = Number(result[1]);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: count <= limit ? 0 : Math.max(1, Math.ceil(ttl / 1000)),
    };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`puls:rl:${key}`);
  }
}

/**
 * Лимитер входа (ТЗ §6). Использует Valkey, если он доступен, иначе
 * автоматически переходит на in-memory — API продолжает работать.
 */
@Injectable()
export class RateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly memory = new MemoryRateLimitStore();
  private readonly redisUrl = process.env.REDIS_URL ?? '';
  private redis: Redis | null = null;
  private remote: RateLimitStore | null = null;

  async onModuleInit(): Promise<void> {
    if (process.env.RATE_LIMIT_STORE === 'memory' || this.redisUrl.length === 0) {
      this.logger.log('Ограничение частоты: in-memory');
      return;
    }

    this.redis = new Redis(this.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    this.redis.on('error', () => undefined);

    try {
      await this.redis.connect();
      await this.redis.ping();
      this.remote = new ValkeyRateLimitStore(this.redis);
      this.logger.log('Ограничение частоты: Valkey');
    } catch (error) {
      this.logger.warn(
        `Valkey недоступен (${
          error instanceof Error ? error.message : 'unknown'
        }), переходим на in-memory`,
      );
      this.redis.disconnect();
      this.redis = null;
      this.remote = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
      this.remote = null;
    }
  }

  /** true — запрос пропущен, false — лимит исчерпан. */
  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const windowMs = windowSeconds * 1_000;

    if (this.remote) {
      try {
        return await this.remote.consume(key, limit, windowMs);
      } catch (error) {
        this.logger.warn(
          `Valkey ответил ошибкой (${
            error instanceof Error ? error.message : 'unknown'
          }), используем in-memory`,
        );
      }
    }

    if (this.memory.size > 10_000) this.memory.prune();
    return this.memory.consume(key, limit, windowMs);
  }

  async reset(key: string): Promise<void> {
    this.memory.reset(key);
    if (this.remote) {
      try {
        await this.remote.reset(key);
      } catch {
        // некритично: истёкшее окно сбросится само
      }
    }
  }
}
