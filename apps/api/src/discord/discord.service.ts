// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Discord-канал уведомлений: привязка аккаунта одноразовым кодом (как в
 * Telegram) и доставка личным сообщением. Вся сеть — за интерфейсом DiscordApi.
 */
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { DiscordStatusResponse } from '@puls/shared';
import { RateLimitService } from '../auth/rate-limit.service';
import { httpError } from '../common/http-error';
import {
  LINK_CODE_TTL_MS,
  generateLinkCode,
  hashLinkCode,
  linkCodeMatches,
} from '../telegram/link-code';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryError, classifyDiscordError } from '../notifications/outbox-logic';
import { DISCORD_API, type DiscordApi } from './discord-api';
import { parseLinkText, type IncomingDiscordEvent } from './discord-events';

export const DISCORD_LINK_CODE_LIMIT = 5;
export const DISCORD_LINK_CODE_WINDOW_SECONDS = 10 * 60;

const TEXT = {
  hint: 'Чтобы привязать Discord к «Пульсу», откройте Настройки → Уведомления → Discord, получите код и отправьте мне: /link КОД',
  linked: 'Готово! Discord привязан к «Пульсу». Уведомления будут приходить сюда.',
  already: 'Этот Discord уже привязан к аккаунту «Пульса».',
  invalid: 'Код не подошёл или истёк. Получите новый в Настройки → Уведомления → Discord.',
  taken: 'Этот Discord уже привязан к другому аккаунту.',
};

@Injectable()
export class DiscordService implements OnModuleInit {
  private readonly logger = new Logger(DiscordService.name);
  private readonly token = process.env.DISCORD_BOT_TOKEN ?? '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    @Inject(DISCORD_API) private readonly api: DiscordApi,
  ) {}

  get enabled(): boolean {
    return this.token.length > 0;
  }

  onModuleInit(): void {
    if (!this.enabled) this.logger.warn('DISCORD_BOT_TOKEN не задан — Discord-бот неактивен');
  }

  async status(userId: string): Promise<DiscordStatusResponse> {
    const link = await this.prisma.discordLink.findUnique({ where: { userId } });
    return {
      enabled: this.enabled,
      linked: link !== null,
      blocked: link?.blockedAt != null,
      username: link?.username ?? null,
      linkedAt: link?.linkedAt.toISOString() ?? null,
    };
  }

  /** Одноразовый код для привязки; в БД попадает только хеш. */
  async createLinkCode(userId: string) {
    if (!this.enabled) throw httpError(503, 'discord_disabled', 'Discord-бот не настроен');

    const limit = await this.rateLimit.consume(
      `discord:link-code:${userId}`,
      DISCORD_LINK_CODE_LIMIT,
      DISCORD_LINK_CODE_WINDOW_SECONDS,
    );
    if (!limit.allowed) {
      throw httpError(429, 'rate_limited', 'Слишком много запросов кода. Попробуйте позже', {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    await this.prisma.discordLinkCode.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });
    const code = generateLinkCode();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    await this.prisma.discordLinkCode.create({
      data: { userId, codeHash: hashLinkCode(code), expiresAt },
    });
    return {
      code,
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: Math.round(LINK_CODE_TTL_MS / 1000),
    };
  }

  async unlink(userId: string): Promise<boolean> {
    const result = await this.prisma.discordLink.deleteMany({ where: { userId } });
    return result.count > 0;
  }

  /**
   * Отправка личного сообщения. Бросает DeliveryError: blocked — привязки нет
   * или Discord вернул 50007 (повторять бессмысленно).
   */
  async deliver(userId: string, content: string): Promise<void> {
    const link = await this.prisma.discordLink.findUnique({ where: { userId } });
    if (!link) throw new DeliveryError('discord: аккаунт не привязан', { blocked: true });
    try {
      await this.api.sendMessage(link.dmChannelId, content);
    } catch (error) {
      throw classifyDiscordError(error);
    }
  }

  /** Помечает привязку заблокированной (доставка остановлена). */
  async markBlocked(userId: string): Promise<void> {
    await this.prisma.discordLink.updateMany({
      where: { userId, blockedAt: null },
      data: { blockedAt: new Date() },
    });
  }

  /* ----- Входящие события ----- */

  async handleEvent(event: IncomingDiscordEvent): Promise<void> {
    if (!this.enabled) return;

    if (event.kind === 'interaction') {
      if (event.command !== 'link') return;
      const reply = await this.link(event.discordUserId, event.username, event.code);
      await this.safe(() => this.api.respondInteraction(event.interactionId, event.token, reply));
      return;
    }

    const parsed = parseLinkText(event.text);
    if (parsed.kind === 'link') {
      const reply = await this.link(event.discordUserId, event.username, parsed.code);
      await this.safe(() => this.api.sendMessage(event.channelId, reply));
      return;
    }

    // Любая другая реплика: подсказка; а для заблокированной привязки — признак,
    // что пользователь снова открыт для бота.
    await this.prisma.discordLink.updateMany({
      where: { discordUserId: event.discordUserId, blockedAt: { not: null } },
      data: { blockedAt: null },
    });
    await this.safe(() => this.api.sendMessage(event.channelId, TEXT.hint));
  }

  /** Привязывает Discord-аккаунт по коду; возвращает текст ответа. */
  private async link(
    discordUserId: string,
    username: string | null,
    code: string | null,
  ): Promise<string> {
    const existing = await this.prisma.discordLink.findUnique({ where: { discordUserId } });
    if (!code) return existing ? TEXT.already : TEXT.hint;

    const record = await this.prisma.discordLinkCode.findUnique({
      where: { codeHash: hashLinkCode(code) },
    });
    const valid =
      record !== null &&
      record.usedAt === null &&
      record.expiresAt.getTime() > Date.now() &&
      linkCodeMatches(code, record.codeHash);
    if (!valid || !record) return existing ? TEXT.already : TEXT.invalid;

    if (existing && existing.userId !== record.userId) return TEXT.taken;
    if (existing && !existing.blockedAt) return TEXT.already;

    let dmChannelId: string;
    try {
      dmChannelId = await this.api.createDmChannel(discordUserId);
    } catch (error) {
      this.logger.warn(
        `Не удалось открыть личный канал: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return TEXT.invalid;
    }

    await this.prisma.$transaction(async (db) => {
      await db.discordLink.deleteMany({ where: { userId: record.userId } });
      await db.discordLink.create({
        data: { userId: record.userId, discordUserId, dmChannelId, username },
      });
      await db.discordLinkCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    });
    return TEXT.linked;
  }

  private async safe(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.logger.warn(
        `Не удалось ответить в Discord: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
