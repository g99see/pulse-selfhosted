// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Чистая логика outbox уведомлений: экспоненциальный backoff, переход статусов
 * и разбор ошибок Telegram/Discord (заблокированный бот — не ретраим).
 */
import type { DeliveryStatus } from '@puls/shared';

/** Максимум попыток отправки одной записи. */
export const MAX_ATTEMPTS = 5;
/** Базовая пауза перед повтором: 30 с, далее ×2, потолок — час. */
export const BASE_BACKOFF_MS = 30_000;
export const MAX_BACKOFF_MS = 60 * 60 * 1000;

/** Ошибка доставки с признаком «получатель закрыт для бота» и подсказкой Retry-After. */
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly options: { blocked?: boolean; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'DeliveryError';
  }

  get blocked(): boolean {
    return this.options.blocked === true;
  }
}

/** Пауза после N-й неудачной попытки (N ≥ 1): 30 с, 1 м, 2 м, 4 м … до часа. */
export function backoffDelayMs(failedAttempts: number): number {
  const exponent = Math.max(0, failedAttempts - 1);
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** exponent);
}

export interface DeliveryState {
  status: Exclude<DeliveryStatus, 'sent'>;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string;
}

/**
 * Состояние записи после неудачной попытки: заблокирован → blocked без
 * повторов; исчерпаны попытки → failed; иначе остаётся queued с backoff.
 */
export function stateAfterFailure(
  attemptsBefore: number,
  error: unknown,
  now: Date,
): DeliveryState {
  const attempts = attemptsBefore + 1;
  const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 500);

  if (error instanceof DeliveryError && error.blocked) {
    return { status: 'blocked', attempts, nextAttemptAt: now, lastError };
  }
  if (attempts >= MAX_ATTEMPTS) {
    return { status: 'failed', attempts, nextAttemptAt: now, lastError };
  }

  const hinted = error instanceof DeliveryError ? (error.options.retryAfterMs ?? 0) : 0;
  const delay = Math.max(backoffDelayMs(attempts), hinted);
  return {
    status: 'queued',
    attempts,
    nextAttemptAt: new Date(now.getTime() + delay),
    lastError,
  };
}

interface TelegramErrorLike {
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
  message?: string;
}

/** Ошибка Telegram Bot API (grammY GrammyError) → DeliveryError. 403 = бот заблокирован. */
export function classifyTelegramError(error: unknown): DeliveryError {
  if (error instanceof DeliveryError) return error;
  const e = (error ?? {}) as TelegramErrorLike;
  const message = e.description ?? e.message ?? 'telegram_error';

  if (e.error_code === 403 || /bot was blocked|user is deactivated/i.test(message)) {
    return new DeliveryError(`telegram: ${message}`, { blocked: true });
  }
  const retryAfter = e.parameters?.retry_after;
  return new DeliveryError(`telegram: ${message}`, {
    retryAfterMs: typeof retryAfter === 'number' ? retryAfter * 1000 : undefined,
  });
}

/** Код Discord 50007 — «Cannot send messages to this user» (DM закрыты). */
export const DISCORD_CANNOT_DM = 50007;

export interface DiscordErrorLike {
  status?: number;
  code?: number;
  retryAfterMs?: number;
  message?: string;
}

/** Ошибка Discord REST → DeliveryError. */
export function classifyDiscordError(error: unknown): DeliveryError {
  if (error instanceof DeliveryError) return error;
  const e = (error ?? {}) as DiscordErrorLike;
  const message = e.message ?? 'discord_error';
  if (e.code === DISCORD_CANNOT_DM) {
    return new DeliveryError(`discord: ${message} (50007)`, { blocked: true });
  }
  return new DeliveryError(`discord: ${message}`, { retryAfterMs: e.retryAfterMs });
}
