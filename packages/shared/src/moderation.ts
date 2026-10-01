// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Жалобы и модерация (ТЗ §2, §3.7, §3.8). Общие для API и web: схемы запросов,
 * словари значений (совпадают с Prisma-перечислениями) и типы ответов.
 * Жалоба — на профиль, пост, комментарий или HTML-страницу; решение принимает
 * модератор или администратор.
 */
import { z } from 'zod';

/** Тип цели жалобы (ТЗ §3.7, §3.8). */
export const REPORT_TARGET_TYPES = ['profile', 'post', 'comment', 'html_page'] as const;
export const ReportTargetTypeSchema = z.enum(REPORT_TARGET_TYPES);
export type ReportTargetType = z.infer<typeof ReportTargetTypeSchema>;

/** Причина жалобы (ТЗ §3.7). */
export const REPORT_REASONS = ['spam', 'abuse', 'phishing', 'illegal', 'other'] as const;
export const ReportReasonSchema = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof ReportReasonSchema>;

/** Статус жалобы: открыта, рассмотрена, отклонена. */
export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export const ReportStatusSchema = z.enum(REPORT_STATUSES);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

/** Действие модератора по жалобе (ТЗ §2, §3.8). */
export const MODERATION_ACTIONS = ['hide', 'unhide', 'ban_html', 'unban_html', 'dismiss'] as const;
export const ModerationActionSchema = z.enum(MODERATION_ACTIONS);
export type ModerationAction = z.infer<typeof ModerationActionSchema>;

/** Роли, которым доступна модерация (ТЗ §2): модератор и администратор. */
export const MODERATOR_ROLES = ['moderator', 'admin'] as const;

/** Может ли роль модерировать: используется в RolesGuard и при показе UI. */
export function canModerate(role: string | null | undefined): boolean {
  return role === 'moderator' || role === 'admin';
}

/** Ограничение длины пояснения жалобы (ТЗ §3.7: не более 1000 символов). */
export const REPORT_DETAILS_MAX = 1000;
/** Ограничение длины примечания модератора. */
export const MODERATION_NOTE_MAX = 1000;

/** `POST /api/reports` (ТЗ §3.7): любая цель, кроме собственного профиля. */
export const ReportCreateSchema = z.object({
  targetType: ReportTargetTypeSchema,
  targetId: z.string().trim().min(1, { message: 'Не указана цель жалобы' }).max(128),
  reason: ReportReasonSchema,
  details: z
    .string()
    .trim()
    .max(REPORT_DETAILS_MAX, { message: 'Слишком длинное пояснение' })
    .optional(),
});
export type ReportCreateInput = z.infer<typeof ReportCreateSchema>;
export type ReportCreateValues = z.input<typeof ReportCreateSchema>;

/** `GET /api/moderation/reports?status=` — фильтр по статусу, по умолчанию все. */
export const ReportsQuerySchema = z.object({
  status: ReportStatusSchema.optional(),
});
export type ReportsQueryInput = z.infer<typeof ReportsQuerySchema>;

/** `POST /api/moderation/reports/:id/resolve` — решение модератора. */
export const ModerationResolveSchema = z.object({
  action: ModerationActionSchema,
  note: z.string().trim().max(MODERATION_NOTE_MAX).optional(),
});
export type ModerationResolveInput = z.infer<typeof ModerationResolveSchema>;
export type ModerationResolveValues = z.input<typeof ModerationResolveSchema>;

/* ----- Контракты ответов API (общие для web и api) ----- */

/** Краткие данные автора жалобы/действия для карточки модерации. */
export interface ActorSummary {
  id: string;
  nickname: string;
}

export interface ReportDto {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  resolution: string | null;
  resolvedBy: string | null;
  createdAt: string;
  /** Автор жалобы (для очереди модерации). */
  reporter: ActorSummary;
}

export interface ModerationActionDto {
  id: string;
  action: ModerationAction;
  targetType: ReportTargetType;
  targetId: string;
  note: string | null;
  createdAt: string;
  /** Модератор, совершивший действие. */
  moderator: ActorSummary;
}

export interface ReportsResponse {
  reports: ReportDto[];
}

export interface ModerationActionsResponse {
  actions: ModerationActionDto[];
}

/** Ответ закрытия жалобы: обновлённая жалоба и запись в журнале модерации. */
export interface ModerationResolveResponse {
  report: ReportDto;
  action: ModerationActionDto;
}
