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
  'forgot-password',
  'login',
  'logout',
  'me',
  'onboarding',
  'register',
  'reset-password',
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

/** Пустая строка в необязательном поле почты — то же, что «не указана». */
const optionalEmailSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  emailSchema.optional(),
);

/**
 * Регистрация (v3 §7.2): логин, пароль и повтор пароля; почта необязательна —
 * нужна только для сброса пароля письмом. `passwordConfirm` сверяется, если передан
 * (web всегда его шлёт; старые клиенты без поля продолжают работать).
 */
export const RegisterSchema = z
  .object({
    nickname: nicknameSchema,
    password: passwordSchema,
    passwordConfirm: z.string().max(128).optional(),
    email: optionalEmailSchema,
    locale: LocaleSchema.default('ru'),
  })
  .refine(
    (value) => value.passwordConfirm === undefined || value.passwordConfirm === value.password,
    {
      path: ['passwordConfirm'],
      message: 'Пароли не совпадают',
    },
  );
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type RegisterInputValues = z.input<typeof RegisterSchema>;

/**
 * Вход: логин (nickname) ИЛИ почта + пароль. Поле `email` принимается как
 * синоним `login` — так продолжают работать клиенты, входившие по почте.
 */
export const LoginSchema = z.preprocess(
  (raw) => {
    if (raw !== null && typeof raw === 'object') {
      const value = raw as Record<string, unknown>;
      if (value.login === undefined && value.email !== undefined) {
        return { ...value, login: value.email };
      }
    }
    return raw;
  },
  z.object({
    login: z.string().trim().toLowerCase().min(1, { message: 'Введите логин или почту' }).max(254),
    password: z.string().min(1, { message: 'Введите пароль' }).max(128),
  }),
);
export type LoginInput = z.output<typeof LoginSchema>;
export type LoginInputValues = { login: string; password: string };

/** Ответ проверки доступности логина (`GET /auth/nickname-available`). */
export interface NicknameAvailabilityResponse {
  available: boolean;
  /** invalid — не проходит формат или зарезервирован; taken — занят. */
  reason: 'invalid' | 'taken' | null;
}

/** Оценка надёжности пароля 0–4 для индикатора на форме регистрации. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length === 0) return 0;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  else if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score += 0.5;
  // Короче минимума пароль не может быть «надёжным».
  if (password.length < 8) return Math.min(1, Math.ceil(score)) as 0 | 1;
  return Math.min(4, Math.max(1, Math.floor(score))) as 1 | 2 | 3 | 4;
}

/** Пароль по токену (сброс или установка): новый пароль и повтор. */
export const PasswordTokenSchema = z
  .object({
    token: z.string().min(10).max(200),
    password: passwordSchema,
    passwordConfirm: z.string().max(128).optional(),
    /** Только для токена установки: логин, если ещё не задан осмысленный. */
    nickname: nicknameSchema.optional(),
  })
  .refine(
    (value) => value.passwordConfirm === undefined || value.passwordConfirm === value.password,
    {
      path: ['passwordConfirm'],
      message: 'Пароли не совпадают',
    },
  );
export type PasswordTokenInput = z.infer<typeof PasswordTokenSchema>;

/** Запрос письма со ссылкой сброса: логин или почта. */
export const ForgotPasswordSchema = z.object({
  login: z.string().trim().toLowerCase().min(1).max(254),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

/** Что за токеном пароля: нужно ли ещё задать логин (`GET /auth/password-token`). */
export interface PasswordTokenInfo {
  valid: boolean;
  purpose: 'reset' | 'setup' | null;
  nickname: string | null;
}

export const VerifyEmailSchema = z.object({
  token: z.string().min(10).max(200),
});
export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;

export const ResendVerificationSchema = z.object({
  email: emailSchema,
});
export type ResendVerificationInput = z.infer<typeof ResendVerificationSchema>;

/** Шаги 2–4 онбординга (ТЗ §3.1): цели, расписание уведомлений. */
export const GoalKindSchema = z.enum(['money', 'health', 'habits']);
export type GoalKind = z.infer<typeof GoalKindSchema>;

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
  // Шаг 3 — цели и уведомления.
  goals: z.array(GoalKindSchema).min(1).max(3),
  notificationsEnabled: z.boolean().default(true),
  quietHoursStart: z.number().int().min(0).max(23).default(22),
  quietHoursEnd: z.number().int().min(0).max(23).default(8),
  // Шаг 4 — первый счёт (необязателен, можно настроить позже).
  firstAccount: FirstAccountSchema.optional(),
});
export type OnboardingInput = z.infer<typeof OnboardingSchema>;
export type OnboardingInputValues = z.input<typeof OnboardingSchema>;

/** Пользователь в ответах API (без хеша пароля и служебных полей). */
export interface PublicUser {
  id: string;
  /** null — почта не указана (необязательна). */
  email: string | null;
  nickname: string;
  /** Роль (ТЗ §9 п.7): user | moderator | admin. */
  role: string;
  timezone: string;
  currency: string;
  locale: string;
  goals: string[];
  notificationsEnabled: boolean;
  quietHours: { start: number; end: number };
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
   * true — email технический (аккаунт создан через Google без подтверждённого
   * адреса); UI показывает мягкую подсказку.
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

/** Ответ входа: сессия выдана, отдаём пользователя. */
export interface LoginResponse {
  user: PublicUser;
}
export type LoginResult = LoginResponse;
