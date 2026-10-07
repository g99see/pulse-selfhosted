// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Чистый разбор событий Discord Gateway в простые намерения: личное сообщение
 * боту и slash-команда /link. Без сети и БД — покрыто unit-тестами.
 */

export type IncomingDiscordEvent =
  | {
      kind: 'message';
      discordUserId: string;
      username: string | null;
      channelId: string;
      text: string;
    }
  | {
      kind: 'interaction';
      discordUserId: string;
      username: string | null;
      interactionId: string;
      token: string;
      command: string;
      /** Значение опции code (для /link). */
      code: string | null;
    };

interface DiscordUser {
  id?: unknown;
  username?: unknown;
  bot?: unknown;
}

function userOf(raw: unknown): { id: string; username: string | null; bot: boolean } | null {
  if (raw === null || typeof raw !== 'object') return null;
  const user = raw as DiscordUser;
  if (typeof user.id !== 'string') return null;
  return {
    id: user.id,
    username: typeof user.username === 'string' ? user.username : null,
    bot: user.bot === true,
  };
}

/** MESSAGE_CREATE → событие; игнорирует ботов и сообщения из серверов (guild_id). */
export function parseMessageCreate(data: unknown): IncomingDiscordEvent | null {
  if (data === null || typeof data !== 'object') return null;
  const message = data as Record<string, unknown>;
  if (typeof message.guild_id === 'string') return null;
  const author = userOf(message.author);
  if (!author || author.bot) return null;
  if (typeof message.channel_id !== 'string' || typeof message.content !== 'string') return null;
  return {
    kind: 'message',
    discordUserId: author.id,
    username: author.username,
    channelId: message.channel_id,
    text: message.content,
  };
}

/** INTERACTION_CREATE (тип 2, slash-команда) → событие. */
export function parseInteractionCreate(data: unknown): IncomingDiscordEvent | null {
  if (data === null || typeof data !== 'object') return null;
  const interaction = data as Record<string, unknown>;
  if (interaction.type !== 2) return null;
  const inner = interaction.data as { name?: unknown; options?: unknown } | undefined;
  if (!inner || typeof inner.name !== 'string') return null;

  // В личке пользователь лежит в user, на сервере — в member.user.
  const member = interaction.member as { user?: unknown } | undefined;
  const user = userOf(interaction.user) ?? userOf(member?.user);
  if (!user) return null;
  if (typeof interaction.id !== 'string' || typeof interaction.token !== 'string') return null;

  let code: string | null = null;
  if (Array.isArray(inner.options)) {
    for (const option of inner.options as { name?: unknown; value?: unknown }[]) {
      if (option.name === 'code' && typeof option.value === 'string') code = option.value;
    }
  }

  return {
    kind: 'interaction',
    discordUserId: user.id,
    username: user.username,
    interactionId: interaction.id,
    token: interaction.token,
    command: inner.name,
    code,
  };
}

/**
 * Текст личного сообщения → токен привязки: «/start TOKEN», «/link TOKEN» или
 * без слэша. Пользователю не нужно вводить код вручную из настроек — токен
 * приходит из deep-link, но запасной путь остаётся (ТЗ §6).
 */
export function parseLinkText(raw: string): { kind: 'link'; code: string } | { kind: 'other' } {
  const text = raw.trim();
  const match = /^\/?(?:start|link)\s+([A-Za-z0-9_-]{8,64})$/i.exec(text);
  if (match) return { kind: 'link', code: match[1]! };
  return { kind: 'other' };
}
