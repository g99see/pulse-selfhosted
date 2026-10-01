// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Telegram-бот (ТЗ §3.6, §4): привязка чата к аккаунту, чек-ины и быстрые траты
 * из чата. Вся сеть — за интерфейсом TelegramApi, вся БД — через существующие
 * сервисы (checkins, finance, stats) и Prisma. Строгая изоляция: чужой chat_id
 * без привязки получает только подсказку и ничего не пишет в БД.
 */
import { HttpException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CheckinsService } from '../checkins/checkins.service';
import { RateLimitService } from '../auth/rate-limit.service';
import { httpError } from '../common/http-error';
import { TransactionsService } from '../finance/transactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { StatsService } from '../stats/stats.service';
import { moodKeyboard, parseCallback, parseCommand, undoKeyboard, type InlineButton } from './commands';
import { generateLinkCode, hashLinkCode, linkCodeMatches, LINK_CODE_TTL_MS } from './link-code';
import {
  alreadyLinkedText,
  chatTakenText,
  checkinQuestionText,
  checkinSavedText,
  helpText,
  invalidCodeText,
  linkRequiredText,
  linkedText,
  noAccountText,
  startHintText,
  todayText,
  transactionCancelledText,
  transactionFailedText,
  transactionSavedText,
  undoMissingText,
  unknownText,
  unlinkedText,
} from './messages';
import { TELEGRAM_API, type TelegramApi } from './telegram-api';
import type { IncomingCallback, IncomingMessage, IncomingUpdate } from './updates';
import { normalizeUpdate } from './updates';

/** Сколько кодов привязки можно запросить за окно (ТЗ §6: ограничение частоты). */
export const LINK_CODE_LIMIT = 5;
export const LINK_CODE_WINDOW_SECONDS = 10 * 60;

export interface TelegramStatus {
  enabled: boolean;
  mode: 'webhook' | 'polling';
  linked: boolean;
  chatUsername: string | null;
  linkedAt: string | null;
}

export interface LinkCodeResult {
  code: string;
  expiresAt: string;
  ttlSeconds: number;
}

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  /** Читается в поле: без токена модуль неактивен, но API продолжает работать. */
  private readonly token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  private readonly mode: 'webhook' | 'polling' =
    process.env.TELEGRAM_MODE === 'polling' ? 'polling' : 'webhook';

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkins: CheckinsService,
    private readonly transactions: TransactionsService,
    private readonly stats: StatsService,
    private readonly rateLimit: RateLimitService,
    @Inject(TELEGRAM_API) private readonly api: TelegramApi,
  ) {}

  get enabled(): boolean {
    return this.token.length > 0;
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn('TELEGRAM_BOT_TOKEN не задан — Telegram-бот неактивен');
      return;
    }
    this.logger.log(`Telegram-бот активен, режим: ${this.mode}`);
  }

  /* ----- Привязка чата ----- */

  async status(userId: string): Promise<TelegramStatus> {
    const link = await this.prisma.telegramLink.findUnique({ where: { userId } });
    return {
      enabled: this.enabled,
      mode: this.mode,
      linked: link !== null,
      chatUsername: link?.username ?? null,
      linkedAt: link?.linkedAt.toISOString() ?? null,
    };
  }

  /** Одноразовый код для привязки чата; в БД попадает только хеш. */
  async createLinkCode(userId: string): Promise<LinkCodeResult> {
    if (!this.enabled) {
      throw httpError(503, 'telegram_disabled', 'Telegram-бот не настроен');
    }

    const limit = await this.rateLimit.consume(
      `telegram:link-code:${userId}`,
      LINK_CODE_LIMIT,
      LINK_CODE_WINDOW_SECONDS,
    );
    if (!limit.allowed) {
      throw httpError(429, 'rate_limited', 'Слишком много запросов кода. Попробуйте позже', {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    await this.prisma.telegramLinkCode.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });

    const code = generateLinkCode();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    await this.prisma.telegramLinkCode.create({
      data: { userId, codeHash: hashLinkCode(code), expiresAt },
    });

    return { code, expiresAt: expiresAt.toISOString(), ttlSeconds: Math.round(LINK_CODE_TTL_MS / 1000) };
  }

  /** Отвязка чата текущего пользователя. */
  async unlink(userId: string): Promise<boolean> {
    const result = await this.prisma.telegramLink.deleteMany({ where: { userId } });
    return result.count > 0;
  }

  /** Отправка в чат пользователя; false — если чат не привязан. */
  async sendToUser(userId: string, text: string, buttons?: InlineButton[][]): Promise<boolean> {
    const link = await this.prisma.telegramLink.findUnique({ where: { userId } });
    if (!link) return false;
    await this.send(link.chatId, text, buttons);
    return true;
  }

  /* ----- Обработка апдейтов ----- */

  async handleUpdate(update: unknown): Promise<void> {
    if (!this.enabled) return;
    const incoming: IncomingUpdate | null = normalizeUpdate(update);
    if (!incoming) return;
    if (incoming.kind === 'callback') return this.handleCallback(incoming);
    return this.handleMessage(incoming);
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    const command = parseCommand(message.text);
    const link = await this.prisma.telegramLink.findUnique({ where: { chatId: message.chatId } });

    if (command.kind === 'start') {
      if (!command.code) {
        await this.send(message.chatId, link ? alreadyLinkedText() : startHintText());
        return;
      }

      const code = await this.resolveCode(command.code);
      if (!code) {
        await this.send(message.chatId, link ? alreadyLinkedText() : invalidCodeText());
        return;
      }

      // Чат уже занят другим аккаунтом — перепривязка невозможна.
      if (link && link.userId !== code.userId) {
        await this.send(message.chatId, chatTakenText());
        return;
      }
      if (link) {
        await this.send(message.chatId, alreadyLinkedText());
        return;
      }

      const result = await this.linkChat(code.userId, message.chatId, message.username, code.id);
      if (result === 'taken') {
        await this.send(message.chatId, chatTakenText());
        return;
      }
      await this.send(message.chatId, linkedText(message.username));
      return;
    }

    // Изоляция: чужой чат без привязки — только подсказка, никаких данных.
    if (!link) {
      await this.send(message.chatId, linkRequiredText());
      return;
    }

    switch (command.kind) {
      case 'checkin':
        await this.send(message.chatId, checkinQuestionText(), moodKeyboard());
        return;
      case 'today': {
        const day = await this.stats.day(link.userId);
        await this.send(message.chatId, todayText(day));
        return;
      }
      case 'help':
        await this.send(message.chatId, helpText());
        return;
      case 'unlink':
        await this.prisma.telegramLink.deleteMany({ where: { userId: link.userId } });
        await this.send(message.chatId, unlinkedText());
        return;
      case 'quick':
        await this.handleQuick(link.userId, message.chatId, command.text);
        return;
      default:
        await this.send(message.chatId, unknownText());
    }
  }

  private async handleQuick(userId: string, chatId: string, text: string): Promise<void> {
    try {
      const transaction = await this.transactions.quick(userId, text);
      await this.send(chatId, transactionSavedText(transaction), undoKeyboard(transaction.id));
    } catch (error) {
      if (errorCode(error) === 'no_account') {
        await this.send(chatId, noAccountText());
        return;
      }
      await this.send(chatId, transactionFailedText());
    }
  }

  private async handleCallback(callback: IncomingCallback): Promise<void> {
    const link = await this.prisma.telegramLink.findUnique({ where: { chatId: callback.chatId } });
    if (!link) {
      await this.send(callback.chatId, linkRequiredText());
      return;
    }

    const parsed = parseCallback(callback.data);

    if (parsed.kind === 'mood') {
      await this.checkins.create(link.userId, { mood: parsed.mood, tags: [] });
      const text = checkinSavedText(parsed.mood);
      await this.answer(callback.callbackQueryId, text);
      await this.send(callback.chatId, text);
      return;
    }

    if (parsed.kind === 'undo') {
      const existing = await this.prisma.transaction.findFirst({
        where: { id: parsed.transactionId, userId: link.userId },
      });
      if (!existing) {
        await this.answer(callback.callbackQueryId, undoMissingText());
        await this.send(callback.chatId, undoMissingText());
        return;
      }

      await this.transactions.remove(link.userId, parsed.transactionId);
      const text = transactionCancelledText({
        comment: existing.comment,
        amount: Number(existing.amount),
        currency: existing.currency,
      });
      await this.answer(callback.callbackQueryId, text);
      await this.send(callback.chatId, text);
      return;
    }

    await this.answer(callback.callbackQueryId);
    await this.send(callback.chatId, unknownText());
  }

  /* ----- Внутреннее ----- */

  private async send(chatId: string, text: string, buttons?: InlineButton[][]): Promise<void> {
    // Ответ бота — best-effort: сбой Telegram не должен ломать вебхук (иначе
    // Telegram повторит апдейт и создаст дубли).
    try {
      await this.api.sendMessage({ chatId, text, buttons });
    } catch (error) {
      this.logger.warn(
        `Не удалось отправить сообщение в чат ${chatId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  /** Закрытие «часиков» на кнопке — тоже best-effort. */
  private async answer(callbackQueryId: string, text?: string): Promise<void> {
    try {
      await this.api.answerCallbackQuery(callbackQueryId, text);
    } catch (error) {
      this.logger.warn(
        `Не удалось ответить на callback: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /** Находит действующий одноразовый код; null — истёк, использован или не найден. */
  private async resolveCode(
    code: string,
  ): Promise<{ id: string; userId: string } | null> {
    const record = await this.prisma.telegramLinkCode.findUnique({
      where: { codeHash: hashLinkCode(code) },
    });
    if (!record || record.usedAt !== null) return null;
    if (record.expiresAt.getTime() <= Date.now()) return null;
    if (!linkCodeMatches(code, record.codeHash)) return null;
    return { id: record.id, userId: record.userId };
  }

  /** Привязывает чат: один чат — один аккаунт, у пользователя один чат. */
  private async linkChat(
    userId: string,
    chatId: string,
    username: string | null,
    codeId: string,
  ): Promise<'linked' | 'taken'> {
    const occupied = await this.prisma.telegramLink.findUnique({ where: { chatId } });
    if (occupied && occupied.userId !== userId) return 'taken';

    await this.prisma.$transaction(async (db) => {
      await db.telegramLink.deleteMany({ where: { userId } });
      await db.telegramLink.create({ data: { userId, chatId, username } });
      await db.telegramLinkCode.update({ where: { id: codeId }, data: { usedAt: new Date() } });
      // Включаем чек-ин-вопросы в Telegram (ТЗ §3.6): канал telegram.
      await db.notificationRule.upsert({
        where: { userId_type_channel: { userId, type: 'checkins', channel: 'telegram' } },
        create: { userId, type: 'checkins', channel: 'telegram', enabled: true },
        update: { enabled: true },
      });
    });

    return 'linked';
  }
}

/** Код ошибки из HttpException единого формата API. */
function errorCode(error: unknown): string | null {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (response !== null && typeof response === 'object' && 'code' in response) {
      return String((response as { code: unknown }).code);
    }
  }
  return null;
}
