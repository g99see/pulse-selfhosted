// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import { HtmlPageService } from './html-page.service';
import { sandboxCsp } from './sandbox.controller';

describe('sandboxCsp', () => {
  it('использует https для обычного домена', () => {
    // '' вместо undefined: иначе параметр по умолчанию берёт PUBLIC_ORIGIN из окружения.
    expect(sandboxCsp('puls.example.com', '')).toContain('frame-ancestors https://puls.example.com');
  });
  it('использует http для localhost', () => {
    expect(sandboxCsp('localhost', '')).toContain('frame-ancestors http://localhost');
  });
  it('PUBLIC_ORIGIN задаёт точный origin', () => {
    const csp = sandboxCsp('192.168.1.50', 'http://192.168.1.50:8081/');
    expect(csp).toContain('frame-ancestors http://192.168.1.50:8081');
    expect(csp).not.toContain('https://');
  });
});

describe('HtmlPageService.sandboxUrl', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const svc = () => new HtmlPageService({} as never, {} as never);

  it('по умолчанию https://SANDBOX_DOMAIN', () => {
    delete process.env.SANDBOX_ORIGIN;
    process.env.SANDBOX_DOMAIN = 'usercontent.example.com';
    expect(svc().sandboxUrl('anna')).toBe('https://usercontent.example.com/sandbox/anna');
  });
  it('SANDBOX_ORIGIN имеет приоритет', () => {
    process.env.SANDBOX_ORIGIN = 'http://192.168.1.50:8080/';
    expect(svc().sandboxUrl('anna')).toBe('http://192.168.1.50:8080/sandbox/anna');
  });
});
