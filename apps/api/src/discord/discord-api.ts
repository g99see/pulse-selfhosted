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
  /** getMe: идентификация общего бота Pulse для deep-link (ТЗ §6). */
  getMe(): Promise<{ id: string | null; username: string | null }>;
  /** Обмен OAuth-кода на пользователя Discord (привязка одним нажатием, ТЗ §6). */
  exchangeOAuthCode(
    code: string,
    redirectUri: string,
  ): Promise<{ userId: string; username: string | null }>;
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

/** Определение slash-команды /password (ссылка для смены пароля, v3 §7). */
export const PASSWORD_COMMAND = {
  name: 'password',
  type: 1,
  description: 'Get a one-time link to set a new Puls password',
  description_localizations: { ru: 'Ссылка для смены или установки пароля Пульса' },
  dm_permission: true,
};

/** Заглушка без токена: ничего не делает. */
export class NullDiscordApi implements DiscordApi {
  async createDmChannel(discordUserId: string): Promise<string> {
    return `dm-${discordUserId}`;
  }
  async sendMessage(): Promise<void> {}
  async respondInteraction(): Promise<void> {}
  async registerCommands(): Promise<void> {}
  async getMe(): Promise<{ id: string | null; username: string | null }> {
    return { id: null, username: null };
  }
  async exchangeOAuthCode(): Promise<{ userId: string; username: string | null }> {
    throw new DiscordApiError('Discord OAuth не настроен', 503, undefined);
  }
}

/** Фейк для тестов: пишет всё в память, умеет падать по сценарию. */
export class FakeDiscordApi implements DiscordApi {
  readonly sent: { channelId: string; content: string }[] = [];
  readonly responses: { interactionId: string; content: string }[] = [];
  readonly dmChannels = new Map<string, string>();
  /** Ошибки, которые отдадут следующие вызовы sendMessage (по одной на вызов). */
  readonly failures: DiscordApiError[] = [];
  commandsRegistered = 0;
  /** Ответ getMe: имя общего бота для deep-link. */
  botIdentity: { id: string | null; username: string | null } = {
    id: '9000',
    username: 'pulse_bot',
  };
  /** OAuth-код → пользователь Discord: тесты кладут сюда пары без сети. */
  readonly oauthUsers = new Map<string, { userId: string; username: string | null }>();
  /** Ошибка для следующего exchangeOAuthCode; сбрасывается после броска. */
  oauthFailure: DiscordApiError | null = null;

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

  async getMe(): Promise<{ id: string | null; username: string | null }> {
    return this.botIdentity;
  }

  async exchangeOAuthCode(
    code: string,
    _redirectUri: string,
  ): Promise<{ userId: string; username: string | null }> {
    const failure = this.oauthFailure;
    if (failure) {
      this.oauthFailure = null;
      throw failure;
    }
    const user = this.oauthUsers.get(code);
    if (!user) throw new DiscordApiError('invalid_grant', 400, undefined);
    return user;
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
    await this.call('PUT', `/applications/${this.applicationId}/commands`, [
      LINK_COMMAND,
      PASSWORD_COMMAND,
    ]);
  }

  async getMe(): Promise<{ id: string | null; username: string | null }> {
    const me = await this.call<{ id?: string; username?: string }>('GET', '/users/@me');
    return { id: me.id ?? null, username: me.username ?? null };
  }

  /**
   * Обмен OAuth-кода (grant_type=authorization_code) на access_token, затем
   * GET /users/@me за идентификатором пользователя. Секрет клиента — из env.
   */
  async exchangeOAuthCode(
    code: string,
    redirectUri: string,
  ): Promise<{ userId: string; username: string | null }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.applicationId,
      client_secret: process.env.DISCORD_CLIENT_SECRET ?? '',
    });
    const tokenResponse = await fetch(`${BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResponse.ok) {
      throw new DiscordApiError(`OAuth ${tokenResponse.status}`, tokenResponse.status, undefined);
    }
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!token.access_token) throw new DiscordApiError('OAuth: нет access_token', 400, undefined);

    const userResponse = await fetch(`${BASE_URL}/users/@me`, {
      headers: { authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!userResponse.ok) {
      throw new DiscordApiError(`users/@me ${userResponse.status}`, userResponse.status, undefined);
    }
    const user = (await userResponse.json()) as { id?: string; username?: string };
    if (!user.id) throw new DiscordApiError('OAuth: нет id пользователя', 400, undefined);
    return { userId: user.id, username: user.username ?? null };
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
