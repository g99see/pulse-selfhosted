// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, MESSAGES, t } from '../src/lib/i18n';

describe('i18n', () => {
  it('uses Russian by default and returns the requested string', () => {
    expect(DEFAULT_LOCALE).toBe('ru');
    expect(t('auth.register.title')).toContain('аккаунт');
  });

  it('has the same keys in ru and en', () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES.ru).sort());
  });

  it('translates to English when asked', () => {
    expect(t('auth.login.title', 'en')).toMatch(/sign in/i);
  });

  it('falls back to the key itself for unknown strings', () => {
    expect(t('nope.missing')).toBe('nope.missing');
  });

  it('never ships an empty string', () => {
    for (const dictionary of [MESSAGES.ru, MESSAGES.en]) {
      for (const value of Object.values(dictionary)) {
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});
