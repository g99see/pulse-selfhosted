// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Выбор origin песочницы (ТЗ §3.8) при нескольких адресах установки: например
 * http://192.168.1.50:8080 (LAN) и https://puls.x.ts.net:8443 (Tailscale).
 * iframe с http на https-странице блокируется как mixed content, поэтому
 * берём origin, совпадающий со страницей по протоколу и хосту.
 */

/** Разбирает список origin через пробел/запятую, убирая слэши и дубли. */
export function parseSandboxOrigins(raw: string | undefined): string[] {
  const list = (raw ?? '')
    .split(/[\s,]+/)
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return list.filter((origin, i) => list.indexOf(origin) === i);
}

function parts(origin: string): { protocol: string; hostname: string } | null {
  try {
    const url = new URL(origin);
    return { protocol: url.protocol, hostname: url.hostname };
  } catch {
    return null;
  }
}

/** Совпадение: протокол+хост → протокол → первый. */
export function pickSandboxOrigin(
  origins: readonly string[],
  page: { protocol: string; hostname: string },
): string {
  const parsed = origins.map((origin) => ({ origin, ...parts(origin) }));
  const exact = parsed.find((o) => o.protocol === page.protocol && o.hostname === page.hostname);
  if (exact) return exact.origin;
  const sameProtocol = parsed.find((o) => o.protocol === page.protocol);
  return (sameProtocol ?? parsed[0])?.origin ?? '';
}

/** Адрес страницы: у абсолютного sandboxUrl остаётся только путь. */
export function buildSandboxPageUrl(sandboxUrl: string, origin: string): string {
  let path: string;
  if (/^https?:\/\//i.test(sandboxUrl)) {
    try {
      const url = new URL(sandboxUrl);
      path = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return sandboxUrl;
    }
  } else {
    path = sandboxUrl.startsWith('/') ? sandboxUrl : `/sandbox/${sandboxUrl}`;
  }
  return `${origin.replace(/\/+$/, '')}${path}`;
}
