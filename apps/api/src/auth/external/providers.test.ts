// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты доступности провайдеров (ТЗ §3.1, §7): без ключей владельца
// внешние входы выключены и кнопки в UI скрыты.
import { describe, expect, it } from 'vitest';
import { googleConfig, providerAvailability, telegramConfig } from './providers';

describe('providerAvailability', () => {
  it('оба провайдера доступны при полном наборе ключей', () => {
    const availability = providerAvailability({
      GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'secret',
      TELEGRAM_BOT_TOKEN: '123456:ABC',
      TELEGRAM_BOT_USERNAME: 'puls_bot',
    });

    expect(availability).toEqual({
      google: true,
      telegram: true,
      telegramBotUsername: 'puls_bot',
    });
  });

  it('без ключей всё выключено', () => {
    expect(providerAvailability({})).toEqual({
      google: false,
      telegram: false,
      telegramBotUsername: null,
    });
  });

  it('google выключен, если нет клиентского секрета', () => {
    expect(providerAvailability({ GOOGLE_CLIENT_ID: 'only-id' }).google).toBe(false);
  });

  it('telegram выключен, если нет имени бота', () => {
    const availability = providerAvailability({ TELEGRAM_BOT_TOKEN: '123:ABC' });
    expect(availability.telegram).toBe(false);
    expect(availability.telegramBotUsername).toBeNull();
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

  it('telegramConfig возвращает null при неполных ключах', () => {
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: 't' })).toBeNull();
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_BOT_USERNAME: 'bot' })).toEqual({
      botToken: 't',
      botUsername: 'bot',
    });
  });
});
