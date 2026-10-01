// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Схемы регистрации, входа и онбординга (ТЗ §3.1, §6). Общие для API и web,
 * чтобы валидация и сообщения совпадали на обеих сторонах.
 */
import { z } from 'zod';

export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 32;

/** Разрешены строчные латинские буквы, цифры, дефис и подчёркивание. */
export const NICKNAME_REGEX = /^[a-z0-9][a-z0-9_-]{2,31}$/;

/** Служебные адреса, которые нельзя занять под никнейм профиля. */
export const RESERVED_NICKNAMES: readonly string[] = [
  'admin',
  'api',
  'app',
  'assets',
  'favicon',
  'health',
  'help',
  'login',
  'logout',
  'me',
  'onboarding',
  'register',
  'robots',
  'sessions',
  'settings',
  'signin',
  'signup',
  'static',
  'support',
  'user',
  'users',
  'verify-email',
  'www',
];

export const SUPPORTED_LOCALES = ['ru', 'en'] as const;
export const LocaleSchema = z.enum(SUPPORTED_LOCALES);
export type Locale = z.infer<typeof LocaleSchema>;

/** Список валют для онбординга (ТЗ §3.1: «валюта и часовой пояс»). */
export const SUPPORTED_CURRENCIES = [
  'RUB',
  'USD',
  'EUR',
  'KZT',
  'BYN',
  'UAH',
  'GBP',
  'TRY',
  'GEL',
  'AMD',
  'UZS',
  'KGS',
  'AZN',
  'MDL',
  'PLN',
  'CZK',
  'CHF',
  'CNY',
  'JPY',
  'INR',
  'AED',
  'ILS',
  'CAD',
  'AUD',
  'BRL',
  'MXN',
  'SEK',
  'NOK',
  'DKK',
  'HUF',
  'RON',
  'BGN',
] as const;
export const currencySchema = z.enum(SUPPORTED_CURRENCIES);
export type CurrencyCode = z.infer<typeof currencySchema>;

/** Проверка IANA-зоны через Intl — работает и в Node, и в браузере. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimezone, { message: 'Неизвестный часовой пояс' });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Некорректный email' }))
  .pipe(z.string().max(254, { message: 'Email слишком длинный' }));

export const passwordSchema = z
  .string()
  .min(8, { message: 'Пароль короче 8 символов' })
  .max(128, { message: 'Пароль длиннее 128 символов' });

export const nicknameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .regex(NICKNAME_REGEX, {
        message: 'Никнейм: 3–32 символа, латиница, цифры, дефис или подчёркивание',
      })
      .refine((value) => !RESERVED_NICKNAMES.includes(value), {
        message: 'Этот никнейм занят или зарезервирован',
      }),
  );

export const RegisterSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  nickname: nicknameSchema,
  locale: LocaleSchema.default('ru'),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type RegisterInputValues = z.input<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: 'Введите пароль' }).max(128),
});
export type LoginInput = z.infer<typeof LoginSchema>;
export type LoginInputValues = z.input<typeof LoginSchema>;

export const VerifyEmailSchema = z.object({
  token: z.string().min(10).max(200),
});
export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;

export const ResendVerificationSchema = z.object({
  email: emailSchema,
});
export type ResendVerificationInput = z.infer<typeof ResendVerificationSchema>;

/** Шаги 2–4 онбординга (ТЗ §3.1): цели, расписание уведомлений, приватность. */
export const GoalKindSchema = z.enum(['money', 'health', 'habits']);
export type GoalKind = z.infer<typeof GoalKindSchema>;

export const ProfileVisibilitySchema = z.enum(['public', 'subscribers', 'private']);
export type ProfileVisibility = z.infer<typeof ProfileVisibilitySchema>;

export const AccountTypeSchema = z.enum(['card', 'cash', 'savings']);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const FirstAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: AccountTypeSchema.default('card'),
  /** Начальный остаток в основной валюте пользователя (может быть 0). */
  balance: z.number().min(0).max(1_000_000_000).default(0),
});
export type FirstAccountInput = z.infer<typeof FirstAccountSchema>;

export const OnboardingSchema = z.object({
  // Шаг 1 — валюта и часовой пояс.
  timezone: timezoneSchema,
  currency: currencySchema,
  // Шаг 2 — язык интерфейса.
  locale: LocaleSchema.default('ru'),
  // Шаг 3 — цели, уведомления и приватность по умолчанию.
  goals: z.array(GoalKindSchema).min(1).max(3),
  notificationsEnabled: z.boolean().default(true),
  quietHoursStart: z.number().int().min(0).max(23).default(22),
  quietHoursEnd: z.number().int().min(0).max(23).default(8),
  profileVisibility: ProfileVisibilitySchema.default('private'),
  // Шаг 4 — первый счёт (необязателен, можно настроить позже).
  firstAccount: FirstAccountSchema.optional(),
});
export type OnboardingInput = z.infer<typeof OnboardingSchema>;
export type OnboardingInputValues = z.input<typeof OnboardingSchema>;

/** Пользователь в ответах API (без хеша пароля и служебных полей). */
export interface PublicUser {
  id: string;
  email: string;
  nickname: string;
  /** Роль (ТЗ §9 п.7): user | moderator | admin. */
  role: string;
  timezone: string;
  currency: string;
  locale: string;
  goals: string[];
  notificationsEnabled: boolean;
  quietHours: { start: number; end: number };
  profileVisibility: string;
  emailVerified: boolean;
  onboardingStep: number;
  onboardingCompleted: boolean;
  createdAt: string;
}

/** Ответ эндпоинтов входа/подтверждения. */
export interface AuthResponse {
  user: PublicUser;
}

export interface MeResponse {
  user: PublicUser;
  onboardingCompleted: boolean;
  /**
   * true — аккаунт создан через Telegram и технический email стоит заменить
   * своим (ТЗ §3.1, §7). UI показывает мягкую подсказку.
   */
  needsEmail?: boolean;
}

export interface OnboardingResponse {
  user: PublicUser;
  onboardingCompleted: boolean;
  accounts: Array<{ id: string; name: string; type: string; currency: string; balance: number }>;
}

export interface SessionSummary {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface SessionsResponse {
  sessions: SessionSummary[];
}
