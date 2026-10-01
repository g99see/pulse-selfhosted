// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты схем экспорта и удаления аккаунта (ТЗ §3.1, §6).
import { describe, expect, it } from 'vitest';
import {
  DeleteAccountSchema,
  EXPORT_FORMAT_NAME,
  EXPORT_FORMAT_VERSION,
  ExportQuerySchema,
} from '../src/account';

describe('ExportQuerySchema', () => {
  it('по умолчанию отдаёт json', () => {
    expect(ExportQuerySchema.parse({})).toEqual({ format: 'json' });
  });

  it('принимает csv и отклоняет незнакомый формат', () => {
    expect(ExportQuerySchema.parse({ format: 'csv' })).toEqual({ format: 'csv' });
    expect(ExportQuerySchema.safeParse({ format: 'xlsx' }).success).toBe(false);
    expect(ExportQuerySchema.safeParse({ format: '' }).success).toBe(false);
  });
});

describe('DeleteAccountSchema', () => {
  it('требует пароль и фразу подтверждения', () => {
    expect(DeleteAccountSchema.parse({ password: 'Secret12345', confirm: 'my-nick' })).toEqual({
      password: 'Secret12345',
      confirm: 'my-nick',
    });
  });

  it('обрезает пробелы в подтверждении', () => {
    expect(DeleteAccountSchema.parse({ password: 'Secret12345', confirm: '  nick  ' }).confirm).toBe('nick');
  });

  it('отклоняет пустой пароль, пустое подтверждение и слишком длинный пароль', () => {
    expect(DeleteAccountSchema.safeParse({ password: '', confirm: 'nick' }).success).toBe(false);
    expect(DeleteAccountSchema.safeParse({ password: 'Secret12345', confirm: '   ' }).success).toBe(false);
    expect(DeleteAccountSchema.safeParse({ password: 'x'.repeat(129), confirm: 'nick' }).success).toBe(false);
    expect(DeleteAccountSchema.safeParse({ confirm: 'nick' }).success).toBe(false);
  });
});

describe('версия формата', () => {
  it('задана положительным целым и именем документа', () => {
    expect(EXPORT_FORMAT_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(EXPORT_FORMAT_VERSION)).toBe(true);
    expect(EXPORT_FORMAT_NAME).toMatch(/^[a-z.]+$/);
  });
});
