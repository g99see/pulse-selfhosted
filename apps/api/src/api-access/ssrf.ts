// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * SSRF-защита исходящих вебхуков (ТЗ §4): запрещаем localhost, приватные,
 * link-local и резервные адреса, а также всё, кроме http(s). Проверяем и
 * литерал адреса, и результат DNS-резолва. Для локальной разработки можно
 * ослабить проверку переменной WEBHOOKS_ALLOW_PRIVATE=1.
 */
import { lookup } from 'node:dns/promises';
import { httpError } from '../common/http-error';

export interface SsrfCheckOptions {
  /** Разрешить приватные адреса (только dev: WEBHOOKS_ALLOW_PRIVATE=1). */
  allowPrivate?: boolean;
}

/** Читает флаг послабления из окружения. */
export function allowPrivateWebhooks(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.WEBHOOKS_ALLOW_PRIVATE?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

/** Суффиксы хостов, которые почти наверняка локальны. */
const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.home.arpa'];

function blocked(host: string): Error {
  return httpError(400, 'webhook_url_private', `Адрес ${host} ведёт в приватную сеть`);
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (nums.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return nums;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = parseIpv4(ip);
  if (!parts) return false;
  const [a, b] = parts as [number, number, number, number];

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // CGNAT 100.64.0.0/10 и тестовый 198.18.0.0/15.
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  // Мультикаст и зарезервированное 224.0.0.0/4, 240.0.0.0/4.
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const value = ip.replace(/^\[/, '').replace(/\]$/, '').split('%')[0]!.toLowerCase();

  if (value === '::1' || value === '::') return true;

  // IPv4-mapped/embedded: ::ffff:127.0.0.1 и подобные.
  const embedded = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value);
  if (embedded) return isPrivateIpv4(embedded[1]!);

  const head = Number.parseInt(value.split(':')[0] || '0', 16);
  if (!Number.isFinite(head)) return false;
  // fc00::/7 — unique local, fe80::/10 — link-local.
  if ((head & 0xfe00) === 0xfc00) return true;
  if ((head & 0xffc0) === 0xfe80) return true;
  return false;
}

/** true — адрес private/loopback/link-local/резервный/мультикаст. */
export function isPrivateIp(ip: string): boolean {
  const value = ip.trim().toLowerCase();
  if (value.includes(':')) return isPrivateIpv6(value);
  return isPrivateIpv4(value);
}

function isIpLiteral(host: string): boolean {
  return parseIpv4(host) !== null || host.includes(':');
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  return BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Проверяет адрес вебхука: схему, хосты и разрешённые IP. Бросает 400 при
 * нарушении. Возвращает разобранный URL для дальнейшего использования.
 */
export async function assertSafeWebhookUrl(
  rawUrl: string,
  options: SsrfCheckOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw httpError(400, 'webhook_url_invalid', 'Некорректный адрес вебхука');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw httpError(400, 'webhook_url_invalid', 'Разрешены только адреса http:// и https://');
  }

  if (options.allowPrivate ?? allowPrivateWebhooks()) return url;

  const hostname = url.hostname.toLowerCase();
  if (isBlockedHostname(hostname)) throw blocked(hostname);

  if (isIpLiteral(hostname)) {
    if (isPrivateIp(hostname)) throw blocked(hostname);
    return url;
  }

  let list: Array<{ address: string; family: number }>;
  try {
    list = await lookup(hostname, { all: true });
  } catch {
    throw httpError(400, 'webhook_host_unresolved', 'Не удалось разрешить адрес вебхука');
  }

  if (list.length === 0) {
    throw httpError(400, 'webhook_host_unresolved', 'Не удалось разрешить адрес вебхука');
  }
  for (const entry of list) {
    if (isPrivateIp(entry.address)) throw blocked(hostname);
  }

  return url;
}
