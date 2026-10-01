// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  LoginSchema,
  OnboardingSchema,
  RegisterSchema,
  VerifyEmailSchema,
  currencySchema,
  nicknameSchema,
  timezoneSchema,
} from '../src/auth';

describe('nicknameSchema', () => {
  it('lowercases and trims a valid nickname', () => {
    expect(nicknameSchema.parse('  Dmitro_M ')).toBe('dmitro_m');
  });

  it('accepts digits, hyphens and underscores', () => {
    expect(nicknameSchema.parse('puls-2026_ok')).toBe('puls-2026_ok');
  });

  it('rejects too short, too long and invalid characters', () => {
    expect(() => nicknameSchema.parse('ab')).toThrow();
    expect(() => nicknameSchema.parse('a'.repeat(33))).toThrow();
    expect(() => nicknameSchema.parse('bad nickname')).toThrow();
    expect(() => nicknameSchema.parse('-leading')).toThrow();
    expect(() => nicknameSchema.parse('КИРИЛЛИЦА')).toThrow();
  });

  it('rejects reserved routes like admin and api', () => {
    expect(() => nicknameSchema.parse('admin')).toThrow();
    expect(() => nicknameSchema.parse('api')).toThrow();
    expect(() => nicknameSchema.parse('login')).toThrow();
  });
});

describe('currencySchema', () => {
  it('accepts an ISO-4217 code from the supported list', () => {
    expect(currencySchema.parse('RUB')).toBe('RUB');
    expect(currencySchema.parse('USD')).toBe('USD');
  });

  it('rejects unknown or lowercase codes', () => {
    expect(() => currencySchema.parse('ZZZ')).toThrow();
    expect(() => currencySchema.parse('rub')).toThrow();
  });
});

describe('timezoneSchema', () => {
  it('accepts a real IANA timezone', () => {
    expect(timezoneSchema.parse('Europe/Moscow')).toBe('Europe/Moscow');
    expect(timezoneSchema.parse('UTC')).toBe('UTC');
  });

  it('rejects a made-up timezone', () => {
    expect(() => timezoneSchema.parse('Mars/Phobos')).toThrow();
  });
});

describe('RegisterSchema', () => {
  it('normalizes email to lowercase and keeps the password untouched', () => {
    const parsed = RegisterSchema.parse({
      email: '  User@Example.COM ',
      password: 'Secret12345',
      nickname: 'Dmitro',
    });

    expect(parsed.email).toBe('user@example.com');
    expect(parsed.nickname).toBe('dmitro');
    expect(parsed.password).toBe('Secret12345');
    expect(parsed.locale).toBe('ru');
  });

  it('rejects a malformed email and a short password', () => {
    expect(() =>
      RegisterSchema.parse({ email: 'nope', password: 'Secret12345', nickname: 'dmitro' }),
    ).toThrow();
    expect(() =>
      RegisterSchema.parse({ email: 'a@b.co', password: 'short', nickname: 'dmitro' }),
    ).toThrow();
  });

  it('rejects passwords longer than 128 characters', () => {
    expect(() =>
      RegisterSchema.parse({
        email: 'a@b.co',
        password: 'x'.repeat(129),
        nickname: 'dmitro',
      }),
    ).toThrow();
  });
});

describe('LoginSchema', () => {
  it('requires a non-empty password', () => {
    expect(() => LoginSchema.parse({ email: 'a@b.co', password: '' })).toThrow();
  });
});

describe('VerifyEmailSchema', () => {
  it('requires a token of a sane length', () => {
    expect(VerifyEmailSchema.parse({ token: 'x'.repeat(43) }).token).toHaveLength(43);
    expect(() => VerifyEmailSchema.parse({ token: 'short' })).toThrow();
  });
});

describe('OnboardingSchema', () => {
  it('applies sensible defaults for the 4 steps', () => {
    const parsed = OnboardingSchema.parse({
      timezone: 'Asia/Almaty',
      currency: 'KZT',
      goals: ['money', 'health'],
    });

    expect(parsed.locale).toBe('ru');
    expect(parsed.notificationsEnabled).toBe(true);
    expect(parsed.quietHoursStart).toBe(22);
    expect(parsed.quietHoursEnd).toBe(8);
    expect(parsed.profileVisibility).toBe('private');
    expect(parsed.firstAccount).toBeUndefined();
  });

  it('accepts a full payload with a first account', () => {
    const parsed = OnboardingSchema.parse({
      timezone: 'Europe/Berlin',
      currency: 'EUR',
      locale: 'en',
      goals: ['habits'],
      notificationsEnabled: false,
      quietHoursStart: 23,
      quietHoursEnd: 7,
      profileVisibility: 'subscribers',
      firstAccount: { name: 'Карта', type: 'card', balance: 1500.5 },
    });

    expect(parsed.firstAccount).toMatchObject({ name: 'Карта', type: 'card', balance: 1500.5 });
    expect(parsed.profileVisibility).toBe('subscribers');
  });

  it('requires at least one goal and a valid timezone', () => {
    expect(() => OnboardingSchema.parse({ timezone: 'UTC', currency: 'RUB', goals: [] })).toThrow();
    expect(() =>
      OnboardingSchema.parse({ timezone: 'Nope/Nope', currency: 'RUB', goals: ['money'] }),
    ).toThrow();
  });
});
