// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Граница с Telegram Bot API (ТЗ §3.6): ядро бота работает через этот интерфейс,
 * реальные HTTP-запросы делает grammY (MIT). В тестах интерфейс подменяется
 * фейком, поэтому ни один тест не ходит в Telegram.
 */
import { Bot } from 'grammy';
import type { InlineButton } from './commands';

export interface OutgoingMessage {
  chatId: string;
  text: string;
  buttons?: InlineButton[][];
}

/** Идентификация общего бота Pulse из Telegram (getMe) для deep-link. */
export interface TelegramBotInfo {
  id: string | null;
  username: string | null;
}

export interface TelegramApi {
  /** Отправляет сообщение в чат; кнопки — inline-клавиатура. */
  sendMessage(message: OutgoingMessage): Promise<void>;
  /** Закрывает «часики» на нажатой inline-кнопке. */
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
  /** Регистрирует меню команд бота (setMyCommands). */
  setCommands(commands: { command: string; description: string }[]): Promise<void>;
  /** Забирает апдейты (режим long polling для разработки). */
  getUpdates(offset: number, timeoutSeconds: number): Promise<unknown[]>;
  /** getMe: имя общего бота для сборки deep-link (ТЗ §6). */
  getMe(): Promise<TelegramBotInfo>;
}

/** Заглушка, когда бот выключен: ничего не делает и не падает. */
export class NullTelegramApi implements TelegramApi {
  async sendMessage(): Promise<void> {
    // Бот не настроен — отправлять некуда.
  }

  async answerCallbackQuery(): Promise<void> {
    // Бот не настроен.
  }

  async setCommands(): Promise<void> {
    // Бот не настроен.
  }

  async getUpdates(): Promise<unknown[]> {
    return [];
  }

  async getMe(): Promise<TelegramBotInfo> {
    return { id: null, username: null };
  }
}

/** Реализация поверх grammY. */
export class GrammyTelegramApi implements TelegramApi {
  private readonly bot: Bot;

  constructor(token: string) {
    this.bot = new Bot(token);
  }

  async sendMessage(message: OutgoingMessage): Promise<void> {
    const replyMarkup = message.buttons
      ? {
          inline_keyboard: message.buttons.map((row) =>
            row.map((button) => ({ text: button.text, callback_data: button.callbackData })),
          ),
        }
      : undefined;

    await this.bot.api.sendMessage(message.chatId, message.text, { reply_markup: replyMarkup });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.bot.api.answerCallbackQuery(callbackQueryId, text ? { text } : undefined);
  }

  async setCommands(commands: { command: string; description: string }[]): Promise<void> {
    await this.bot.api.setMyCommands(commands);
  }

  async getUpdates(offset: number, timeoutSeconds: number): Promise<unknown[]> {
    return (await this.bot.api.getUpdates({
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ['message', 'callback_query'],
    })) as unknown[];
  }

  async getMe(): Promise<TelegramBotInfo> {
    const me = await this.bot.api.getMe();
    return { id: String(me.id), username: me.username ?? null };
  }
}

/** Токен DI для TelegramApi: тесты подменяют его фейком. */
export const TELEGRAM_API = 'TELEGRAM_API';

/**
 * Создаёт клиента Telegram по переменной окружения. Без токена возвращает
 * заглушку: модуль неактивен, но API работает (ТЗ §3.6, §10).
 */
export function createTelegramApi(): TelegramApi {
  // Тестовый/отладочный режим: интерфейс есть, реальных запросов нет.
  if (process.env.TELEGRAM_API_FAKE === '1') return new NullTelegramApi();

  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  if (token.length === 0) return new NullTelegramApi();

  try {
    return new GrammyTelegramApi(token);
  } catch {
    return new NullTelegramApi();
  }
}
