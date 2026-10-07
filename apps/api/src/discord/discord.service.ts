// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Discord-канал уведомлений (ТЗ §6): привязка одним нажатием через OAuth —
 * кнопка в настройках отдаёт ссылку с одноразовым токеном в `state`, Discord
 * возвращает пользователя на /api/discord/callback, где токен проверяется,
 * привязка создаётся, а токен гасится. Запасной путь — личное сообщение
 * боту `/start <токен>`. Вся сеть — за интерфейсом DiscordApi.
 */
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { BotConnectLinkResponse, DiscordStatusResponse } from '@puls/shared';
import { PasswordResetService } from '../auth/password-reset.service';
import { RateLimitService } from '../auth/rate-limit.service';
import { httpError } from '../common/http-error';
import {
  buildDiscordAuthorizeUrl,
  generateLinkToken,
  hashLinkToken,
  linkTokenMatches,
  linkTokenState,
  LINK_TOKEN_TTL_MS,
} from '../telegram/link-token';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryError, classifyDiscordError } from '../notifications/outbox-logic';
import { DISCORD_API, type DiscordApi } from './discord-api';
import { parseLinkText, type IncomingDiscordEvent } from './discord-events';

/** Сколько ссылок привязки можно запросить за окно (ТЗ §6). */
export const DISCORD_LINK_TOKEN_LIMIT = 5;
export const DISCORD_LINK_TOKEN_WINDOW_SECONDS = 10 * 60;

/** Причина отказа OAuth-привязки (для редиректа в настройки). */
export type DiscordOAuthReason =
  'expired' | 'used' | 'invalid' | 'taken' | 'exchange_failed' | 'not_configured';

export interface DiscordOAuthOutcome {
  ok: boolean;
  reason?: DiscordOAuthReason;
  discordUserId?: string;
  username?: string | null;
}

const TEXT = {
  linked: 'Готово! Discord привязан к «Пульсу». Уведомления и чек-ины будут приходить сюда.',
  already: 'Этот Discord уже привязан к аккаунту «Пульса».',
  invalid: 'Ссылка привязки не подошла. Нажмите «Подключить Discord» в настройках Пульса ещё раз.',
  expired: 'Ссылка привязки истекла (10 минут). Нажмите «Подключить Discord» в настройках ещё раз.',
  used: 'Эта ссылка привязки уже использована. Нажмите «Подключить Discord» в настройках ещё раз.',
  taken: 'Этот Discord уже привязан к другому аккаунту «Пульса».',
  hint: 'Чтобы получать уведомления «Пульса», нажмите «Подключить Discord» в настройках на сайте.',
};

@Injectable()
export class DiscordService implements OnModuleInit {
  private readonly logger = new Logger(DiscordService.name);
  private readonly token = process.env.DISCORD_BOT_TOKEN ?? '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly passwordReset: PasswordResetService,
    @Inject(DISCORD_API) private readonly api: DiscordApi,
  ) {}

  get enabled(): boolean {
    return this.token.length > 0;
  }

  /** Настроен ли OAuth-редирект: без него привязку одним нажатием не собрать. */
  private get redirectUri(): string {
    return (process.env.DISCORD_OAUTH_REDIRECT_URI ?? '').trim();
  }

  private get applicationId(): string {
    return (process.env.DISCORD_APPLICATION_ID ?? '').trim();
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

  /**
   * Одноразовая ссылка-подключение (ТЗ §6): токен в `state`, TTL 10 минут,
   * в БД только хеш. Пользователю не нужен Developer Portal — бот один общий.
   */
  async connectLink(userId: string): Promise<BotConnectLinkResponse> {
    if (!this.enabled) throw httpError(503, 'discord_disabled', 'Discord-бот не настроен');
    if (this.applicationId.length === 0 || this.redirectUri.length === 0) {
      throw httpError(
        503,
        'discord_oauth_not_configured',
        'Discord OAuth не настроен: задайте DISCORD_APPLICATION_ID и DISCORD_OAUTH_REDIRECT_URI',
      );
    }

    const limit = await this.rateLimit.consume(
      `discord:connect:${userId}`,
      DISCORD_LINK_TOKEN_LIMIT,
      DISCORD_LINK_TOKEN_WINDOW_SECONDS,
    );
    if (!limit.allowed) {
      throw httpError(429, 'rate_limited', 'Слишком много запросов ссылки. Попробуйте позже', {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    await this.prisma.discordLinkCode.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });

    const token = generateLinkToken();
    const tokenHash = hashLinkToken(token);
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);
    await this.prisma.discordLinkCode.create({ data: { userId, codeHash: tokenHash, expiresAt } });

    return {
      url: buildDiscordAuthorizeUrl(this.applicationId, this.redirectUri, token),
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: Math.round(LINK_TOKEN_TTL_MS / 1000),
    };
  }

  /**
   * Завершение OAuth-привязки (ТЗ §6): проверяет state-токен, обменивает код на
   * пользователя Discord, привязывает аккаунт, гасит токен и шлёт подтверждение.
   * Никогда не бросает — контроллер превращает результат в редирект.
   */
  async completeOAuth(code: string, state: string): Promise<DiscordOAuthOutcome> {
    if (!this.enabled) return { ok: false, reason: 'not_configured' };
    if (code.length === 0 || state.length === 0) return { ok: false, reason: 'invalid' };

    const record = await this.prisma.discordLinkCode.findUnique({
      where: { codeHash: hashLinkToken(state) },
    });
    if (!record || !linkTokenMatches(state, record.codeHash)) {
      return { ok: false, reason: 'invalid' };
    }

    const tokenState = linkTokenState(record);
    if (tokenState === 'expired') return { ok: false, reason: 'expired' };
    if (tokenState === 'used') return { ok: false, reason: 'used' };

    let user: { userId: string; username: string | null };
    try {
      user = await this.api.exchangeOAuthCode(code, this.redirectUri);
    } catch (error) {
      this.logger.warn(
        `Discord OAuth: обмен кода не удался: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { ok: false, reason: 'exchange_failed' };
    }

    const existing = await this.prisma.discordLink.findUnique({
      where: { discordUserId: user.userId },
    });
    if (existing && existing.userId !== record.userId) return { ok: false, reason: 'taken' };

    const bound = await this.bind(record.userId, user.userId, user.username, record.id);
    if (!bound.ok) return { ok: false, reason: bound.reason ?? 'exchange_failed' };
    return { ok: true, discordUserId: user.userId, username: user.username };
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

  /* ----- Входящие события (запасной путь /start <токен>) ----- */

  async handleEvent(event: IncomingDiscordEvent): Promise<void> {
    if (!this.enabled) return;

    if (event.kind === 'interaction') {
      if (event.command === 'password') {
        const reply = await this.passwordLink(event.discordUserId);
        await this.safe(() => this.api.respondInteraction(event.interactionId, event.token, reply));
        return;
      }
      if (event.command !== 'link' && event.command !== 'start') return;
      const reply = await this.bindByToken(event.discordUserId, event.username, event.code);
      await this.safe(() => this.api.respondInteraction(event.interactionId, event.token, reply));
      return;
    }

    // Команда смены пароля в личных сообщениях (v3 §7).
    if (/^[/!]password$/i.test(event.text.trim())) {
      const reply = await this.passwordLink(event.discordUserId);
      await this.safe(() => this.api.sendMessage(event.channelId, reply));
      return;
    }

    const parsed = parseLinkText(event.text);
    if (parsed.kind === 'link') {
      const reply = await this.bindByToken(event.discordUserId, event.username, parsed.code);
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

  /** Команда /password: одноразовая ссылка сброса/установки пароля (30 мин, v3 §7). */
  private async passwordLink(discordUserId: string): Promise<string> {
    const link = await this.prisma.discordLink.findUnique({
      where: { discordUserId },
      include: { user: true },
    });
    if (!link) return TEXT.hint;
    const issued = await this.passwordReset.issue(
      link.userId,
      link.user.passwordHash ? 'reset' : 'setup',
    );
    const duration = link.user.passwordHash ? '30 минут' : '24 часа';
    return `Ссылка для нового пароля «Пульса»:\n${issued.url}\n\nСсылка одноразовая и действует ${duration}.`;
  }

  /** Привязка по токену из личного сообщения/команды; возвращает текст ответа. */
  private async bindByToken(
    discordUserId: string,
    username: string | null,
    token: string | null,
  ): Promise<string> {
    const existing = await this.prisma.discordLink.findUnique({ where: { discordUserId } });
    if (!token) return existing ? TEXT.already : TEXT.hint;

    const record = await this.prisma.discordLinkCode.findUnique({
      where: { codeHash: hashLinkToken(token) },
    });
    if (!record || !linkTokenMatches(token, record.codeHash)) {
      return existing ? TEXT.already : TEXT.invalid;
    }

    const state = linkTokenState(record);
    if (state === 'expired') return TEXT.expired;
    if (state === 'used') return existing ? TEXT.already : TEXT.used;

    if (existing && existing.userId !== record.userId) return TEXT.taken;
    if (existing && !existing.blockedAt) return TEXT.already;

    const bound = await this.bind(record.userId, discordUserId, username, record.id);
    if (!bound.ok) return bound.reason === 'taken' ? TEXT.taken : TEXT.invalid;
    return TEXT.linked;
  }

  /**
   * Создаёт привязку: DM-канал, DiscordLink, гасит токен, включает уведомления
   * в канале discord. Один Discord — один аккаунт, у пользователя — одна связь.
   */
  private async bind(
    userId: string,
    discordUserId: string,
    username: string | null,
    tokenId: string,
  ): Promise<{ ok: boolean; reason?: DiscordOAuthReason }> {
    const occupied = await this.prisma.discordLink.findUnique({ where: { discordUserId } });
    if (occupied && occupied.userId !== userId) return { ok: false, reason: 'taken' };

    let dmChannelId: string;
    try {
      dmChannelId = await this.api.createDmChannel(discordUserId);
    } catch (error) {
      this.logger.warn(
        `Не удалось открыть личный канал: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { ok: false, reason: 'exchange_failed' };
    }

    await this.prisma.$transaction(async (db) => {
      await db.discordLink.deleteMany({ where: { userId } });
      await db.discordLink.create({
        data: { userId, discordUserId, dmChannelId, username },
      });
      await db.discordLinkCode.update({ where: { id: tokenId }, data: { usedAt: new Date() } });
      await db.notificationRule.upsert({
        where: { userId_type_channel: { userId, type: 'checkins', channel: 'discord' } },
        create: { userId, type: 'checkins', channel: 'discord', enabled: true },
        update: { enabled: true },
      });
    });

    await this.safe(() => this.api.sendMessage(dmChannelId, TEXT.linked));
    return { ok: true };
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
