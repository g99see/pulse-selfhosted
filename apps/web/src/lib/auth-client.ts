// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API аутентификации (ТЗ §6, v3 §7): cookie-сессии + CSRF-заголовок.
 * Все запросы идут с credentials: 'include'.
 */
import type {
  ForgotPasswordInput,
  IdentitiesResponse,
  LoginInputValues,
  LoginResult,
  MeResponse,
  NicknameAvailabilityResponse,
  OnboardingInputValues,
  OnboardingResponse,
  PasswordTokenInfo,
  PasswordTokenInput,
  ProvidersResponse,
  PublicUser,
  RegisterInputValues,
  SessionsResponse,
} from '@puls/shared';
import { API_BASE_URL } from './api';

export const CSRF_COOKIE = 'puls_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';

export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

/** Достаёт значение CSRF-cookie из document.cookie. */
export function readCsrfCookie(cookieString: string): string | undefined {
  const entry = cookieString
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CSRF_COOKIE}=`));

  return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE.length + 1)) : undefined;
}

export function csrfHeader(token: string | undefined): Record<string, string> {
  return token ? { [CSRF_HEADER]: token } : {};
}

export async function parseAuthError(response: Response): Promise<AuthApiError> {
  let code = 'unknown_error';
  let message = 'Что-то пошло не так. Попробуйте ещё раз.';

  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    if (typeof body?.code === 'string') code = body.code;
    if (typeof body?.message === 'string') message = body.message;
  } catch {
    // тело не JSON — оставляем общее сообщение
  }

  return new AuthApiError(response.status, code, message);
}

function currentCsrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return readCsrfCookie(document.cookie);
}

/** Гарантирует наличие CSRF-cookie перед мутирующим запросом. */
export async function ensureCsrf(force = false): Promise<string> {
  const existing = currentCsrfToken();
  if (existing && !force) return existing;

  const response = await fetch(`${API_BASE_URL}/api/auth/csrf`, { credentials: 'include' });
  if (!response.ok) throw await parseAuthError(response);
  const body = (await response.json()) as { csrfToken?: string };
  return body.csrfToken ?? currentCsrfToken() ?? '';
}

export async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const url = `${API_BASE_URL}${path}`;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (mutating) await ensureCsrf(attempt > 1);

    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (mutating) {
      for (const [name, value] of Object.entries(csrfHeader(currentCsrfToken()))) {
        headers.set(name, value);
      }
    }

    const response = await fetch(url, {
      ...init,
      method,
      credentials: 'include',
      headers,
    });

    if (response.status === 403 && attempt === 1) {
      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as { code?: string } | null;
      if (body?.code === 'csrf_failed') continue;
    }

    if (!response.ok) throw await parseAuthError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  throw new AuthApiError(403, 'csrf_failed', 'Не удалось обновить CSRF-токен');
}

export const authApi = {
  /** Регистрация (v3 §7.2): логин + пароль, почта необязательна; сразу выдаёт сессию. */
  register: (input: RegisterInputValues) =>
    authFetch<{ user: PublicUser; verificationSent: boolean }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Живая проверка доступности логина на форме регистрации. */
  nicknameAvailable: (nickname: string) =>
    authFetch<NicknameAvailabilityResponse>(
      `/api/auth/nickname-available?nickname=${encodeURIComponent(nickname)}`,
    ),

  /** Вход: логин ИЛИ почта + пароль (v3 §7.3). */
  login: (input: LoginInputValues) =>
    authFetch<LoginResult>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  logout: () => authFetch<void>('/api/auth/logout', { method: 'POST' }),

  me: () => authFetch<MeResponse>('/api/auth/me'),

  /** Ссылка сброса пароля: письмом (если есть почта) или сообщением бота. */
  forgotPassword: (input: ForgotPasswordInput) =>
    authFetch<{ sent: true }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Что за токеном из ссылки сброса/установки пароля. */
  passwordToken: (token: string) =>
    authFetch<PasswordTokenInfo>(`/api/auth/password-token?token=${encodeURIComponent(token)}`),

  /** Новый пароль по токену: завершает прочие сессии и выдаёт текущую. */
  resetPassword: (input: PasswordTokenInput) =>
    authFetch<{ user: PublicUser }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  verifyEmail: (token: string) =>
    authFetch<{ user: PublicUser }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  resendVerification: (email: string) =>
    authFetch<{ sent: true }>('/api/auth/verify-email/resend', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  completeOnboarding: (input: OnboardingInputValues) =>
    authFetch<OnboardingResponse>('/api/auth/onboarding', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  sessions: () => authFetch<SessionsResponse>('/api/auth/sessions'),

  revokeSession: (id: string) => authFetch<void>(`/api/auth/sessions/${id}`, { method: 'DELETE' }),

  /** «Выйти со всех устройств»: завершает все сессии, кроме текущей. */
  revokeOtherSessions: () =>
    authFetch<{ revoked: number }>('/api/auth/sessions', { method: 'DELETE' }),

  /** Включённые владельцем внешние провайдеры (ТЗ §3.1). */
  providers: () => authFetch<ProvidersResponse>('/api/auth/providers'),

  /** Привязанные способы входа текущего пользователя. */
  identities: () => authFetch<IdentitiesResponse>('/api/auth/identities'),

  unlinkIdentity: (provider: string) =>
    authFetch<void>(`/api/auth/identities/${provider}`, { method: 'DELETE' }),
};

/** Полностраничный переход на Google: state и PKCE API держит у себя. */
export function googleLoginUrl(): string {
  return `${API_BASE_URL}/api/auth/google/start`;
}

/** Привязка Google из настроек — тот же поток, но с намерением link. */
export function googleLinkUrl(): string {
  return `${API_BASE_URL}/api/auth/link/google/start`;
}
