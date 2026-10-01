// SPDX-License-Identifier: AGPL-3.0-or-later
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { resolveOccurredAt } from './checkins.service';

const NOW = new Date('2026-10-01T12:00:00.000Z');

function capture(fn: () => unknown): HttpException {
  try {
    fn();
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('ожидалась ошибка');
}

describe('resolveOccurredAt (ТЗ §3.3)', () => {
  it('без значения возвращает текущее время', () => {
    expect(resolveOccurredAt(undefined, NOW).toISOString()).toBe(NOW.toISOString());
  });

  it('принимает время в пределах 24 часов', () => {
    expect(resolveOccurredAt('2026-09-30T13:00:00.000Z', NOW).toISOString()).toBe(
      '2026-09-30T13:00:00.000Z',
    );
  });

  it('отклоняет старше 24 часов кодом checkin_window_expired', () => {
    const error = capture(() => resolveOccurredAt('2026-09-30T11:00:00.000Z', NOW));
    expect(error.getStatus()).toBe(400);
    expect((error.getResponse() as { code: string }).code).toBe('checkin_window_expired');
  });

  it('отклоняет время в будущем', () => {
    const error = capture(() => resolveOccurredAt('2026-10-01T13:00:00.000Z', NOW));
    expect(error.getStatus()).toBe(400);
    expect((error.getResponse() as { code: string }).code).toBe('validation_error');
  });
});
