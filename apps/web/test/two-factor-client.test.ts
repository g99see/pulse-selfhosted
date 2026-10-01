// SPDX-License-Identifier: AGPL-3.0-or-later
// Разбор ответа входа: отличаем обычную сессию от требования второго фактора
// (ТЗ §6) — эту ветку использует страница /login.
import { describe, expect, it } from 'vitest';
import { isTwoFactorRequired } from '@puls/shared';

describe('isTwoFactorRequired', () => {
  it('распознаёт ответ с требованием 2FA', () => {
    expect(isTwoFactorRequired({ twoFactorRequired: true, challengeToken: 'abc' })).toBe(true);
  });

  it('обычный ответ входа не считает 2FA', () => {
    expect(isTwoFactorRequired({ user: { id: '1' } })).toBe(false);
    expect(isTwoFactorRequired({ twoFactorRequired: false })).toBe(false);
    expect(isTwoFactorRequired(null)).toBe(false);
    expect(isTwoFactorRequired('nope')).toBe(false);
  });
});
