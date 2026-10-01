// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { allowPrivateWebhooks, assertSafeWebhookUrl, isPrivateIp } from './ssrf';

describe('SSRF-фильтр адресов вебхуков (ТЗ §4)', () => {
  it('распознаёт приватные, link-local и резервные IPv4', () => {
    const blocked = [
      '127.0.0.1',
      '127.255.255.255',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
    ];
    for (const ip of blocked) expect(isPrivateIp(ip), ip).toBe(true);
  });

  it('считает публичными обычные адреса', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '192.169.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('распознаёт приватные IPv6 и IPv4-mapped', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ['2001:4860:4860::8888', '2606:4700:4700::1111']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('запрещает не-http(s) и локальные адреса без спец-флага', async () => {
    await expect(assertSafeWebhookUrl('ftp://example.com/hook')).rejects.toThrow();
    await expect(assertSafeWebhookUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertSafeWebhookUrl('http://localhost:3000/hook')).rejects.toThrow();
    await expect(assertSafeWebhookUrl('http://127.0.0.1/hook')).rejects.toThrow();
    await expect(assertSafeWebhookUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    await expect(assertSafeWebhookUrl('http://[::1]/hook')).rejects.toThrow();
  });

  it('allowPrivate разрешает локальный адрес только для dev', async () => {
    const url = await assertSafeWebhookUrl('http://127.0.0.1:3000/hook', { allowPrivate: true });
    expect(url.hostname).toBe('127.0.0.1');
  });

  it('allowPrivateWebhooks читает переменную окружения', () => {
    expect(allowPrivateWebhooks({ WEBHOOKS_ALLOW_PRIVATE: '1' })).toBe(true);
    expect(allowPrivateWebhooks({ WEBHOOKS_ALLOW_PRIVATE: 'true' })).toBe(true);
    expect(allowPrivateWebhooks({})).toBe(false);
  });
});
