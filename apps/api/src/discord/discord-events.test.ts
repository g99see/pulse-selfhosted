// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseInteractionCreate, parseLinkText, parseMessageCreate } from './discord-events';

describe('parseMessageCreate', () => {
  const base = {
    channel_id: 'c1',
    content: '/link abc12345',
    author: { id: 'u1', username: 'neo' },
  };

  it('личное сообщение → событие', () => {
    expect(parseMessageCreate(base)).toEqual({
      kind: 'message',
      discordUserId: 'u1',
      username: 'neo',
      channelId: 'c1',
      text: '/link abc12345',
    });
  });

  it('игнорирует ботов и сообщения из серверов', () => {
    expect(parseMessageCreate({ ...base, author: { id: 'b', bot: true } })).toBeNull();
    expect(parseMessageCreate({ ...base, guild_id: 'g1' })).toBeNull();
  });

  it('мусор не падает', () => {
    expect(parseMessageCreate(null)).toBeNull();
    expect(parseMessageCreate({})).toBeNull();
  });
});

describe('parseInteractionCreate', () => {
  it('slash-команда /link code:… из личных сообщений', () => {
    const event = parseInteractionCreate({
      type: 2,
      id: 'i1',
      token: 't1',
      user: { id: 'u1', username: 'neo' },
      data: { name: 'link', options: [{ name: 'code', type: 3, value: 'abc12345' }] },
    });
    expect(event).toMatchObject({ kind: 'interaction', command: 'link', code: 'abc12345' });
  });

  it('на сервере пользователь лежит в member.user', () => {
    const event = parseInteractionCreate({
      type: 2,
      id: 'i1',
      token: 't1',
      member: { user: { id: 'u9' } },
      data: { name: 'link' },
    });
    expect(event).toMatchObject({ discordUserId: 'u9', code: null });
  });

  it('не slash-команды игнорирует', () => {
    expect(parseInteractionCreate({ type: 3, id: 'i', token: 't' })).toBeNull();
  });
});

describe('parseLinkText', () => {
  it('понимает /start, /link и вариант без слэша', () => {
    expect(parseLinkText('/link abc12345')).toEqual({ kind: 'link', code: 'abc12345' });
    expect(parseLinkText('/start abc12345')).toEqual({ kind: 'link', code: 'abc12345' });
    expect(parseLinkText('  LINK abc12345 ')).toEqual({ kind: 'link', code: 'abc12345' });
  });

  it('прочее — other', () => {
    expect(parseLinkText('привет')).toEqual({ kind: 'other' });
    expect(parseLinkText('/link')).toEqual({ kind: 'other' });
  });
});
