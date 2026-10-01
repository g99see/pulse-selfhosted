// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Long polling для разработки (ТЗ §3.6): включается только при
 * TELEGRAM_MODE=polling и заданном токене. В тестах не стартует. При
 * недоступности Telegram цикл ждёт и повторяет — API не падает.
 */
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TELEGRAM_API, type TelegramApi } from './telegram-api';
import { TelegramService } from './telegram.service';

/** Пауза между неудачными попытками получить апдейты, мс. */
const RETRY_DELAY_MS = 3_000;

@Injectable()
export class TelegramPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramPoller.name);
  private readonly token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  private readonly mode = process.env.TELEGRAM_MODE === 'polling' ? 'polling' : 'webhook';
  private readonly autoStart = process.env.NODE_ENV !== 'test';

  private running = false;
  private offset = 0;

  constructor(
    private readonly service: TelegramService,
    @Inject(TELEGRAM_API) private readonly api: TelegramApi,
  ) {}

  onModuleInit(): void {
    if (!this.autoStart) return;
    if (this.mode !== 'polling' || this.token.length === 0) {
      this.logger.log('Long polling не запущен');
      return;
    }
    this.running = true;
    this.logger.log('Telegram-бот: long polling');
    void this.loop();
  }

  onModuleDestroy(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.api.getUpdates(this.offset, 25);
        for (const update of updates) {
          const id = updateId(update);
          if (id !== null && id >= this.offset) this.offset = id + 1;
          await this.service.handleUpdate(update);
        }
      } catch (error) {
        this.logger.warn(
          `Ошибка long polling: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
}

function updateId(update: unknown): number | null {
  if (update === null || typeof update !== 'object') return null;
  const value = (update as { update_id?: unknown }).update_id;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
