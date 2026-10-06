// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Граница с Discord REST API v10: ядро бота работает через интерфейс
 * DiscordApi. Реальные запросы — fetch; в тестах и при DISCORD_API_FAKE=1
 * подставляется FakeDiscordApi, который ничего не отправляет по сети.
 */
import { DISCORD_CANNOT_DM } from '../notifications/outbox-logic';

export const DISCORD_API = 'DISCORD_API';
const BASE_URL = 'https://discord.com/api/v10';

/** Ошибка Discord REST: HTTP-статус, код Discord и Retry-After. */
export class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | undefined,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

export interface DiscordApi {
  /** Открывает (или находит) личный канал с пользователем и возвращает его id. */
  createDmChannel(discordUserId: string): Promise<string>;
  sendMessage(channelId: string, content: string): Promise<void>;
  /** Ответ на slash-команду (виден только вызвавшему). */
  respondInteraction(interactionId: string, token: string, content: string): Promise<void>;
  /** Регистрирует глобальную slash-команду /link. */
  registerCommands(): Promise<void>;
}

/** Определение slash-команды /link code:<код>. */
export const LINK_COMMAND = {
  name: 'link',
  type: 1,
  description: 'Link Discord to your Puls account',
  description_localizations: { ru: 'Привязать Discord к аккаунту Пульса' },
  dm_permission: true,
  options: [
    {
      type: 3,
      name: 'code',
      description: 'One-time code from Puls settings',
      description_localizations: { ru: 'Одноразовый код из настроек Пульса' },
      required: true,
    },
  ],
};

/** Заглушка без токена: ничего не делает. */
export class NullDiscordApi implements DiscordApi {
  async createDmChannel(discordUserId: string): Promise<string> {
    return `dm-${discordUserId}`;
  }
  async sendMessage(): Promise<void> {}
  async respondInteraction(): Promise<void> {}
  async registerCommands(): Promise<void> {}
}

/** Фейк для тестов: пишет всё в память, умеет падать по сценарию. */
export class FakeDiscordApi implements DiscordApi {
  readonly sent: { channelId: string; content: string }[] = [];
  readonly responses: { interactionId: string; content: string }[] = [];
  readonly dmChannels = new Map<string, string>();
  /** Ошибки, которые отдадут следующие вызовы sendMessage (по одной на вызов). */
  readonly failures: DiscordApiError[] = [];
  commandsRegistered = 0;

  async createDmChannel(discordUserId: string): Promise<string> {
    const existing = this.dmChannels.get(discordUserId);
    if (existing) return existing;
    const channelId = `dm-${discordUserId}`;
    this.dmChannels.set(discordUserId, channelId);
    return channelId;
  }

  async sendMessage(channelId: string, content: string): Promise<void> {
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push({ channelId, content });
  }

  async respondInteraction(interactionId: string, _token: string, content: string): Promise<void> {
    this.responses.push({ interactionId, content });
  }

  async registerCommands(): Promise<void> {
    this.commandsRegistered += 1;
  }

  lastTo(channelId: string): { channelId: string; content: string } | undefined {
    return [...this.sent].reverse().find((message) => message.channelId === channelId);
  }

  clear(): void {
    this.sent.length = 0;
    this.responses.length = 0;
    this.failures.length = 0;
  }
}

/** Реальный клиент поверх fetch. */
export class RestDiscordApi implements DiscordApi {
  constructor(
    private readonly token: string,
    private readonly applicationId: string,
  ) {}

  async createDmChannel(discordUserId: string): Promise<string> {
    const body = await this.call<{ id: string }>('POST', '/users/@me/channels', {
      recipient_id: discordUserId,
    });
    return body.id;
  }

  async sendMessage(channelId: string, content: string): Promise<void> {
    await this.call('POST', `/channels/${channelId}/messages`, {
      content: content.slice(0, 2000),
      allowed_mentions: { parse: [] },
    });
  }

  async respondInteraction(interactionId: string, token: string, content: string): Promise<void> {
    // Ответ на интерактивный вызов не требует заголовка Authorization.
    await this.call(
      'POST',
      `/interactions/${interactionId}/${token}/callback`,
      { type: 4, data: { content: content.slice(0, 2000), flags: 64 } },
      false,
    );
  }

  async registerCommands(): Promise<void> {
    if (this.applicationId.length === 0) return;
    await this.call('PUT', `/applications/${this.applicationId}/commands`, [LINK_COMMAND]);
  }

  private async call<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    auth = true,
  ): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'DiscordBot (https://github.com/puls, 1)',
        ...(auth ? { authorization: `Bot ${this.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      return (response.status === 204 ? undefined : await response.json()) as T;
    }

    let payload: { message?: string; code?: number; retry_after?: number } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      // тело не JSON — оставим пустым
    }
    const retryAfterMs =
      typeof payload.retry_after === 'number' ? Math.ceil(payload.retry_after * 1000) : undefined;
    throw new DiscordApiError(
      payload.message ?? `HTTP ${response.status}`,
      response.status,
      payload.code,
      retryAfterMs,
    );
  }
}

/** Создаёт клиента по окружению: фейк, заглушка без токена или REST. */
export function createDiscordApi(): DiscordApi {
  if (process.env.DISCORD_API_FAKE === '1') return new FakeDiscordApi();
  const token = process.env.DISCORD_BOT_TOKEN ?? '';
  if (token.length === 0) return new NullDiscordApi();
  return new RestDiscordApi(token, process.env.DISCORD_APPLICATION_ID ?? '');
}

export { DISCORD_CANNOT_DM };
