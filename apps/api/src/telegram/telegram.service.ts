// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Telegram-бот (ТЗ §3.6, §4): привязка чата к аккаунту, чек-ины и быстрые траты
 * из чата. Вся сеть — за интерфейсом TelegramApi, вся БД — через существующие
 * сервисы (checkins, finance, stats) и Prisma. Строгая изоляция: чужой chat_id
 * без привязки получает только подсказку и ничего не пишет в БД.
 */
import { HttpException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { BotConnectLinkResponse } from '@puls/shared';
import { CheckinDialogService, type DialogOutcome } from '../checkins/checkin-dialog.service';
import { CheckinsService } from '../checkins/checkins.service';
import { RateLimitService } from '../auth/rate-limit.service';
import { httpError } from '../common/http-error';
import { BudgetsService } from '../finance/budgets.service';
import { TransactionsService } from '../finance/transactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { StatsService } from '../stats/stats.service';
import {
  BOT_COMMANDS,
  dialogKeyboard,
  parseCallback,
  parseCommand,
  undoKeyboard,
  type InlineButton,
} from './commands';
import { DeliveryError, classifyTelegramError } from '../notifications/outbox-logic';
import { PasswordResetService } from '../auth/password-reset.service';
import {
  buildTelegramDeepLink,
  generateLinkToken,
  hashLinkToken,
  linkTokenMatches,
  linkTokenState,
  LINK_TOKEN_TTL_MS,
  type LinkTokenState,
} from './link-token';
import {
  alreadyLinkedText,
  chatTakenText,
  checkinLineErrorText,
  checkinSavedText,
  checkinSummaryText,
  dialogCancelledText,
  dialogExpiredText,
  dialogPromptText,
  expiredTokenText,
  helpText,
  invalidTokenText,
  linkRequiredText,
  linkedText,
  noAccountText,
  passwordLinkText,
  spentSavedText,
  spentUsageText,
  startHintText,
  todayText,
  transactionCancelledText,
  transactionFailedText,
  transactionSavedText,
  undoMissingText,
  unknownText,
  unlinkedText,
  usedTokenText,
} from './messages';
import { TELEGRAM_API, type TelegramApi } from './telegram-api';
import type { IncomingCallback, IncomingMessage, IncomingUpdate } from './updates';
import { normalizeUpdate } from './updates';

/** Канал черновиков диалога чек-ина (Discord будет использовать свой). */
export const CHECKIN_CHANNEL = 'telegram';

/** Сколько ссылок привязки можно запросить за окно (ТЗ §6: ограничение частоты). */
export const LINK_TOKEN_LIMIT = 5;
export const LINK_TOKEN_WINDOW_SECONDS = 10 * 60;

export interface TelegramStatus {
  enabled: boolean;
  mode: 'webhook' | 'polling';
  linked: boolean;
  /** Бот заблокирован пользователем: доставка остановлена. */
  blocked: boolean;
  chatUsername: string | null;
  /** Имя общего бота Pulse (env или getMe) для deep-link; null — неизвестно. */
  botUsername: string | null;
  linkedAt: string | null;
}

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  /** Читается в поле: без токена модуль неактивен, но API продолжает работать. */
  private readonly token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  private readonly mode: 'webhook' | 'polling' =
    process.env.TELEGRAM_MODE === 'polling' ? 'polling' : 'webhook';
  /** Кеш имени общего бота: getMe — сетевой вызов, а статус спрашивают часто. */
  private botUsernameCache: string | null = null;
  private botUsernameResolved = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkins: CheckinsService,
    private readonly dialog: CheckinDialogService,
    private readonly transactions: TransactionsService,
    private readonly stats: StatsService,
    private readonly budgets: BudgetsService,
    private readonly rateLimit: RateLimitService,
    private readonly passwordReset: PasswordResetService,
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
    void this.registerCommands();
  }

  /** Меню команд бота (setMyCommands); сбой не критичен. */
  async registerCommands(): Promise<boolean> {
    try {
      await this.api.setCommands(BOT_COMMANDS);
      return true;
    } catch (error) {
      this.logger.warn(
        `Не удалось зарегистрировать команды: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return false;
    }
  }

  /* ----- Привязка чата ----- */

  async status(userId: string): Promise<TelegramStatus> {
    const link = await this.prisma.telegramLink.findUnique({ where: { userId } });
    return {
      enabled: this.enabled,
      mode: this.mode,
      linked: link !== null,
      blocked: link?.blockedAt != null,
      chatUsername: link?.username ?? null,
      botUsername: await this.getBotUsername(),
      linkedAt: link?.linkedAt.toISOString() ?? null,
    };
  }

  /**
   * Имя общего бота Pulse (ТЗ §6): из TELEGRAM_BOT_USERNAME, иначе getMe.
   * Кешируется в поле: getMe — сетевой вызов, а статус запрашивается часто.
   */
  async getBotUsername(): Promise<string | null> {
    if (this.botUsernameResolved) return this.botUsernameCache;
    this.botUsernameResolved = true;

    const fromEnv = (process.env.TELEGRAM_BOT_USERNAME ?? '').trim().replace(/^@/, '');
    if (fromEnv.length > 0) {
      this.botUsernameCache = fromEnv;
      return this.botUsernameCache;
    }

    try {
      const me = await this.api.getMe();
      this.botUsernameCache = me.username ? me.username.replace(/^@/, '') : null;
    } catch (error) {
      this.logger.warn(
        `Не удалось получить имя бота (getMe): ${error instanceof Error ? error.message : 'unknown'}`,
      );
      this.botUsernameCache = null;
    }
    return this.botUsernameCache;
  }

  /**
   * Одноразовая ссылка-подключение (ТЗ §6): кнопка в настройках создаёт токен
   * (TTL 10 минут, в БД только хеш) и отдаёт deep-link на общего бота. Токен
   * гасится ботом при `/start <токен>`.
   */
  async connectLink(userId: string): Promise<BotConnectLinkResponse> {
    if (!this.enabled) {
      throw httpError(503, 'telegram_disabled', 'Telegram-бот не настроен');
    }

    const botUsername = await this.getBotUsername();
    if (botUsername === null) {
      throw httpError(
        503,
        'telegram_bot_username_unavailable',
        'Не удалось определить имя бота Telegram: задайте TELEGRAM_BOT_USERNAME',
      );
    }

    const limit = await this.rateLimit.consume(
      `telegram:connect:${userId}`,
      LINK_TOKEN_LIMIT,
      LINK_TOKEN_WINDOW_SECONDS,
    );
    if (!limit.allowed) {
      throw httpError(429, 'rate_limited', 'Слишком много запросов ссылки. Попробуйте позже', {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    await this.prisma.telegramLinkCode.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });

    const token = generateLinkToken();
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);
    await this.prisma.telegramLinkCode.create({
      data: { userId, codeHash: hashLinkToken(token), expiresAt },
    });

    return {
      url: buildTelegramDeepLink(botUsername, token),
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: Math.round(LINK_TOKEN_TTL_MS / 1000),
    };
  }

  /** Отвязка чата текущего пользователя. */
  async unlink(userId: string): Promise<boolean> {
    const result = await this.prisma.telegramLink.deleteMany({ where: { userId } });
    return result.count > 0;
  }

  /**
   * Доставка из outbox: бросает DeliveryError (blocked — чат не привязан или
   * бот заблокирован, Telegram 403), чтобы воркер мог выбрать backoff или стоп.
   */
  async deliver(userId: string, text: string, buttons?: InlineButton[][]): Promise<void> {
    const link = await this.prisma.telegramLink.findUnique({ where: { userId } });
    if (!link) throw new DeliveryError('telegram: чат не привязан', { blocked: true });
    try {
      await this.api.sendMessage({ chatId: link.chatId, text, buttons });
    } catch (error) {
      throw classifyTelegramError(error);
    }
  }

  /** Помечает привязку заблокированной (бот заблокирован пользователем). */
  async markBlocked(userId: string): Promise<void> {
    await this.prisma.telegramLink.updateMany({
      where: { userId, blockedAt: null },
      data: { blockedAt: new Date() },
    });
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

    // Любая активность в чате — признак, что пользователь снова открыт для бота
    // (ТЗ §6: бот был заблокирован — снимаем блокировку, канал снова активен).
    if (link?.blockedAt) {
      await this.prisma.telegramLink.update({
        where: { userId: link.userId },
        data: { blockedAt: null },
      });
    }

    if (command.kind === 'start') {
      if (!command.token) {
        await this.send(message.chatId, link ? alreadyLinkedText() : startHintText());
        return;
      }

      const resolved = await this.resolveToken(command.token);
      if (!resolved || resolved.state === 'missing') {
        await this.send(message.chatId, link ? alreadyLinkedText() : invalidTokenText());
        return;
      }
      if (resolved.state === 'expired') {
        await this.send(message.chatId, expiredTokenText());
        return;
      }
      if (resolved.state === 'used') {
        await this.send(message.chatId, link ? alreadyLinkedText() : usedTokenText());
        return;
      }

      // Чат уже занят другим аккаунтом — перепривязка невозможна.
      if (link && link.userId !== resolved.userId) {
        await this.send(message.chatId, chatTakenText());
        return;
      }
      if (link) {
        await this.send(message.chatId, alreadyLinkedText());
        return;
      }

      const result = await this.linkChat(
        resolved.userId,
        message.chatId,
        message.username,
        resolved.id,
      );
      if (result === 'taken') {
        await this.send(message.chatId, chatTakenText());
        return;
      }
      await this.send(message.chatId, linkedText(message.username));
      return;
    }

    // Изоляция: чужой чат без привязки — только подсказка, никаких данных.
    if (!link) {
      // Раньше входил через Telegram и пароля нет: присылаем ссылку установки логина и пароля.
      if (await this.sendSetupLinkIfNeeded(message.chatId)) return;
      await this.send(message.chatId, linkRequiredText());
      return;
    }

    // Идёт диалог чек-ина: обычный текст — ответ на текущий шаг (сон, теги, заметка).
    if (
      !message.text.trim().startsWith('/') &&
      (await this.dialog.hasActive(link.userId, CHECKIN_CHANNEL))
    ) {
      const outcome = await this.dialog.handle(link.userId, CHECKIN_CHANNEL, {
        type: 'text',
        text: message.text,
      });
      await this.sendOutcome(message.chatId, outcome);
      return;
    }

    switch (command.kind) {
      case 'checkin': {
        const prompt = await this.dialog.start(link.userId, CHECKIN_CHANNEL);
        await this.sendPrompt(message.chatId, prompt);
        return;
      }
      case 'checkin-line': {
        const saved = await this.dialog.saveLine(link.userId, command.text);
        await this.send(
          message.chatId,
          saved.ok
            ? checkinSummaryText(saved.checkIn)
            : checkinLineErrorText(saved.error, saved.field),
        );
        return;
      }
      case 'mood': {
        if (command.mood === null) {
          await this.send(message.chatId, checkinLineErrorText('mood'));
          return;
        }
        const checkIn = await this.checkins.create(link.userId, { mood: command.mood, tags: [] });
        await this.send(message.chatId, checkinSummaryText(checkIn));
        return;
      }
      case 'today': {
        const day = await this.stats.day(link.userId);
        await this.send(message.chatId, todayText(day));
        return;
      }
      case 'spent': {
        if (command.text === null) {
          await this.send(message.chatId, spentUsageText());
          return;
        }
        await this.handleQuick(link.userId, message.chatId, command.text, true);
        return;
      }
      case 'help':
        await this.send(message.chatId, helpText());
        return;
      case 'unlink':
        await this.prisma.telegramLink.deleteMany({ where: { userId: link.userId } });
        await this.send(message.chatId, unlinkedText());
        return;
      case 'password': {
        const user = await this.prisma.user.findUnique({ where: { id: link.userId } });
        const issued = await this.passwordReset.issue(
          link.userId,
          user?.passwordHash ? 'reset' : 'setup',
        );
        await this.send(message.chatId, passwordLinkText(issued.url, !user?.passwordHash));
        return;
      }
      case 'quick':
        await this.handleQuick(link.userId, message.chatId, command.text);
        return;
      default:
        await this.send(message.chatId, unknownText());
    }
  }

  private async handleQuick(
    userId: string,
    chatId: string,
    text: string,
    withBudget = false,
  ): Promise<void> {
    try {
      const transaction = await this.transactions.quick(userId, text);
      const reply = withBudget
        ? spentSavedText(transaction, await this.budgetFor(userId, transaction))
        : transactionSavedText(transaction);
      await this.send(chatId, reply, undoKeyboard(transaction.id));
    } catch (error) {
      if (errorCode(error) === 'no_account') {
        await this.send(chatId, noAccountText());
        return;
      }
      await this.send(chatId, transactionFailedText());
    }
  }

  /** Бюджет категории операции на её месяц: лимит и потрачено (уже с этой операцией). */
  private async budgetFor(
    userId: string,
    transaction: { type: string; categoryId: string | null; date: string },
  ): Promise<{ limit: number; spent: number; categoryName: string } | null> {
    if (transaction.type !== 'expense' || !transaction.categoryId) return null;
    const month = transaction.date.slice(0, 7);
    const budget = (await this.budgets.list(userId, month)).find(
      (item) => item.categoryId === transaction.categoryId,
    );
    return budget
      ? { limit: budget.limit, spent: budget.spent, categoryName: budget.categoryName }
      : null;
  }

  private async handleCallback(callback: IncomingCallback): Promise<void> {
    const link = await this.prisma.telegramLink.findUnique({ where: { chatId: callback.chatId } });
    if (!link) {
      await this.send(callback.chatId, linkRequiredText());
      return;
    }

    const parsed = parseCallback(callback.data);

    // Кнопка настроения из напоминания (или старого сообщения) запускает диалог.
    if (parsed.kind === 'mood') {
      await this.answer(callback.callbackQueryId, checkinSavedText(parsed.mood));
      const prompt = await this.dialog.start(link.userId, CHECKIN_CHANNEL, { mood: parsed.mood });
      await this.sendPrompt(callback.chatId, prompt);
      return;
    }

    if (parsed.kind === 'checkin') {
      await this.answer(callback.callbackQueryId);
      let outcome = await this.dialog.handle(link.userId, CHECKIN_CHANNEL, {
        type: 'action',
        action: parsed.action,
      });
      // Черновика нет, но это выбор настроения (кнопки напоминания) — начинаем диалог.
      const mood = /^ci:mood:([1-5])$/.exec(parsed.action);
      if (outcome.kind === 'none' && mood) {
        const prompt = await this.dialog.start(link.userId, CHECKIN_CHANNEL, {
          mood: Number(mood[1]),
        });
        outcome = { kind: 'prompt', prompt };
      }
      await this.sendOutcome(callback.chatId, outcome);
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

  private async sendPrompt(
    chatId: string,
    prompt: import('@puls/shared').DialogPrompt,
  ): Promise<void> {
    await this.send(chatId, dialogPromptText(prompt), dialogKeyboard(prompt.rows));
  }

  /** Результат шага диалога → сообщение в чат. */
  private async sendOutcome(chatId: string, outcome: DialogOutcome): Promise<void> {
    switch (outcome.kind) {
      case 'prompt':
      case 'ignored':
        await this.sendPrompt(chatId, outcome.prompt);
        return;
      case 'done':
        await this.send(chatId, checkinSummaryText(outcome.checkIn));
        return;
      case 'cancelled':
        await this.send(chatId, dialogCancelledText());
        return;
      case 'none':
        await this.send(chatId, dialogExpiredText());
        return;
    }
  }

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

  /**
   * Находит токен привязки по хешу и классифицирует его (ТЗ §6): null — записи
   * нет (токен не наш); иначе — состояние ok/expired/used и владелец.
   */
  private async resolveToken(
    token: string,
  ): Promise<{ id: string; userId: string; state: LinkTokenState } | null> {
    const record = await this.prisma.telegramLinkCode.findUnique({
      where: { codeHash: hashLinkToken(token) },
    });
    if (!record || !linkTokenMatches(token, record.codeHash)) return null;
    return { id: record.id, userId: record.userId, state: linkTokenState(record) };
  }

  /**
   * Пользователю без пароля, который раньше входил через Telegram, шлёт ссылку
   * установки логина и пароля (v3 §7.3). Не чаще раза в 10 минут на чат, чтобы
   * не спамить. true — сообщение ушло (или уже отправлялось в этом окне).
   */
  private async sendSetupLinkIfNeeded(chatId: string): Promise<boolean> {
    const identity = await this.prisma.externalIdentity.findUnique({
      where: { provider_subject: { provider: 'telegram', subject: chatId } },
      include: { user: true },
    });
    if (!identity || identity.user.passwordHash !== null) return false;

    const limit = await this.rateLimit.consume(`telegram:setup-link:${chatId}`, 1, 10 * 60);
    if (!limit.allowed) return true;

    const issued = await this.passwordReset.issue(identity.userId, 'setup');
    await this.send(chatId, passwordLinkText(issued.url, true));
    return true;
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
