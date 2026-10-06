// SPDX-License-Identifier: AGPL-3.0-or-later
/** Приватная ссылка «Итог дня» (/d/<токен>): публичные итоги дня без входа. */

/** Что видит открывший ссылку: только итоги дня, без операций и заметок. */
export interface DaySummaryPublicDto {
  day: string;
  currency: string;
  spent: number;
  earned: number;
  avgMood: number | null;
  checkins: number;
  nickname: string;
}

/** Состояние ссылки для настроек; токен возвращается только при создании. */
export interface DaySummaryLinkDto {
  active: boolean;
  createdAt: string | null;
}

export interface DaySummaryLinkCreatedDto extends DaySummaryLinkDto {
  token: string;
  /** Путь для публичной страницы, например `/d/abc…`. */
  path: string;
}

/** Токен — 32 байта в base64url (43 символа). */
export const DAY_SUMMARY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
