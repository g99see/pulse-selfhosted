// SPDX-License-Identifier: AGPL-3.0-or-later
// Привязка бота одной кнопкой (ТЗ §6): строки нового экрана. Ключи одноразового
// кода удалены — если они вернутся или пропадут новые, тест упадёт.
import { describe, expect, it } from 'vitest';
import { MESSAGES, t } from '../src/lib/i18n';

const NEW_KEYS = [
  'notifications.channel.connect',
  'notifications.channel.connecting',
  'notifications.channel.connectHint.telegram',
  'notifications.channel.connectHint.discord',
  'notifications.channel.waiting',
];

const KEPT_KEYS = [
  'notifications.channel.link',
  'notifications.channel.unlink',
  'notifications.channel.refresh',
  'notifications.channel.ttl',
];

const REMOVED_KEYS = [
  'notifications.channel.newCode',
  'notifications.channel.codeTitle',
  'notifications.channel.codeHint.telegram',
  'notifications.channel.codeHint.discord',
  'notifications.channel.copy',
  'notifications.channel.copied',
];

describe('подключение бота одной кнопкой (ТЗ §6)', () => {
  it('новые ключи есть в обоих языках и переведены', () => {
    for (const key of NEW_KEYS) {
      expect(MESSAGES.ru[key], `ru ${key}`).toBeTruthy();
      expect(MESSAGES.en[key], `en ${key}`).toBeTruthy();
      expect(t(key, 'ru')).not.toBe(key);
      expect(t(key, 'en')).not.toBe(key);
      expect(t(key, 'en')).not.toBe(t(key, 'ru'));
    }
  });

  it('сохраняет нужные ключи статуса и ttl', () => {
    for (const key of KEPT_KEYS) {
      expect(MESSAGES.ru[key], `ru ${key}`).toBeTruthy();
      expect(MESSAGES.en[key], `en ${key}`).toBeTruthy();
    }
  });

  it('ключи одноразового кода удалены из обоих языков', () => {
    for (const key of REMOVED_KEYS) {
      expect(MESSAGES.ru[key], `ru ${key}`).toBeUndefined();
      expect(MESSAGES.en[key], `en ${key}`).toBeUndefined();
    }
  });

  it('подставляет название канала и минуты ttl', () => {
    expect(t('notifications.channel.connecting', 'en', { channel: 'Discord' })).toContain(
      'Discord',
    );
    expect(t('notifications.channel.ttl', 'en', { minutes: 10 })).toContain('10');
  });
});
