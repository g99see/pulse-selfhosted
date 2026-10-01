// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Схемы экспорта и удаления аккаунта (ТЗ §3.1, §6). Общие для API и web,
 * чтобы валидация запроса и формат ответа совпадали на обеих сторонах.
 */
import { z } from 'zod';

/** Форматы выгрузки: единый JSON-документ или ZIP с CSV по сущностям. */
export const EXPORT_FORMATS = ['json', 'csv'] as const;
export const ExportFormatSchema = z.enum(EXPORT_FORMATS);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

/** Имя документа выгрузки — маркер формата для сторонних инструментов. */
export const EXPORT_FORMAT_NAME = 'puls.export';

/** Версия формата выгрузки: растёт при несовместимом изменении документа. */
export const EXPORT_FORMAT_VERSION = 1;

/** `GET /api/account/export?format=json|csv` — по умолчанию JSON. */
export const ExportQuerySchema = z.object({
  format: ExportFormatSchema.default('json'),
});
export type ExportQueryInput = z.infer<typeof ExportQuerySchema>;

/**
 * Подтверждение удаления (ТЗ §3.1): пароль плюс фраза — собственный никнейм.
 * Проверку совпадения с никнеймом делает API: здесь только форма.
 */
export const DeleteAccountSchema = z.object({
  password: z
    .string()
    .min(1, { message: 'Введите пароль' })
    .max(128, { message: 'Пароль слишком длинный' }),
  confirm: z.string().trim().min(1, { message: 'Введите никнейм для подтверждения' }).max(64),
});
export type DeleteAccountInput = z.infer<typeof DeleteAccountSchema>;
