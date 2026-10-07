// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты доступности провайдеров (ТЗ §3.1, §7): без ключей владельца
// Google-вход выключен и кнопка в UI скрыта. Вход через Telegram удалён (v3 §7.3).
import { describe, expect, it } from 'vitest';
import { googleConfig, providerAvailability } from './providers';

describe('providerAvailability', () => {
  it('Google доступен при полном наборе ключей', () => {
    expect(
      providerAvailability({
        GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'secret',
        TELEGRAM_BOT_TOKEN: '123456:ABC',
        TELEGRAM_BOT_USERNAME: 'puls_bot',
      }),
    ).toEqual({ google: true });
  });

  it('без ключей всё выключено; токен Telegram-бота больше не включает вход', () => {
    expect(providerAvailability({})).toEqual({ google: false });
    expect(providerAvailability({ TELEGRAM_BOT_TOKEN: '1:A', TELEGRAM_BOT_USERNAME: 'b' })).toEqual(
      { google: false },
    );
  });

  it('google выключен, если нет клиентского секрета', () => {
    expect(providerAvailability({ GOOGLE_CLIENT_ID: 'only-id' }).google).toBe(false);
  });

  it('игнорирует пустые строки', () => {
    expect(providerAvailability({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }).google).toBe(
      false,
    );
  });
});

describe('конфигурации провайдеров', () => {
  it('googleConfig возвращает null при неполных ключах', () => {
    expect(googleConfig({ GOOGLE_CLIENT_ID: 'id' })).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' })).toEqual({
      clientId: 'id',
      clientSecret: 's',
    });
  });
});
