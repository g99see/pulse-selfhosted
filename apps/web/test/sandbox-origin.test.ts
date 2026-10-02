// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { normalizeApiBase } from '../src/lib/api';
import {
  buildSandboxPageUrl,
  parseSandboxOrigins,
  pickSandboxOrigin,
} from '../src/lib/sandbox-origin';

const LAN = 'http://192.168.1.50:8080';
const TS = 'https://puls.x.ts.net:8443';

describe('normalizeApiBase', () => {
  it('"/" и пусто означают тот же origin', () => {
    expect(normalizeApiBase('/')).toBe('');
    expect(normalizeApiBase('')).toBe('');
    expect(normalizeApiBase('http://a.b//')).toBe('http://a.b');
  });
  it('без значения — dev-адрес', () => {
    expect(normalizeApiBase(undefined)).toBe('http://localhost:3001');
  });
});

describe('parseSandboxOrigins', () => {
  it('делит по пробелам, чистит слэши и дубли', () => {
    expect(parseSandboxOrigins(`${LAN}/  ${TS} ${LAN}`)).toEqual([LAN, TS]);
    expect(parseSandboxOrigins(undefined)).toEqual([]);
  });
});

describe('pickSandboxOrigin', () => {
  it('https-страница получает https-песочницу', () => {
    expect(pickSandboxOrigin([LAN, TS], { protocol: 'https:', hostname: 'puls.x.ts.net' })).toBe(
      TS,
    );
  });
  it('LAN по http получает LAN-песочницу', () => {
    expect(pickSandboxOrigin([TS, LAN], { protocol: 'http:', hostname: '192.168.1.50' })).toBe(LAN);
  });
  it('хост важнее: два http-origin', () => {
    const other = 'http://10.0.0.5:8080';
    expect(pickSandboxOrigin([other, LAN], { protocol: 'http:', hostname: '192.168.1.50' })).toBe(
      LAN,
    );
  });
  it('запасной вариант — тот же протокол, затем первый', () => {
    expect(pickSandboxOrigin([LAN, TS], { protocol: 'https:', hostname: 'other.ts.net' })).toBe(TS);
    expect(pickSandboxOrigin([LAN], { protocol: 'https:', hostname: 'z' })).toBe(LAN);
    expect(pickSandboxOrigin([], { protocol: 'https:', hostname: 'z' })).toBe('');
  });
});

describe('buildSandboxPageUrl', () => {
  it('у абсолютного адреса остаётся путь', () => {
    expect(buildSandboxPageUrl('http://192.168.1.50:8080/sandbox/anna?v=2', TS)).toBe(
      `${TS}/sandbox/anna?v=2`,
    );
  });
  it('относительные пути', () => {
    expect(buildSandboxPageUrl('/sandbox/anna', LAN)).toBe(`${LAN}/sandbox/anna`);
    expect(buildSandboxPageUrl('anna', `${LAN}/`)).toBe(`${LAN}/sandbox/anna`);
  });
});
