// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент HTML-страницы профиля (ТЗ §3.8): чтение, сохранение кода, загрузка
 * готового .html, история версий и откат. Контракт и автопроверка живут в
 * `@puls/shared` (html-page.ts); здесь — только сетевой слой и адрес песочницы.
 */
import type { HtmlPageResponse, HtmlPageSaveValues, HtmlPageVersionsResponse } from '@puls/shared';
import { API_BASE_URL } from './api';
import { authFetch, csrfHeader, ensureCsrf, parseAuthError, AuthApiError } from './auth-client';

/**
 * Базовый адрес пользовательского домена (ТЗ §3.8): страница отдаётся с
 * отдельного домена в iframe с sandbox="allow-scripts". Пусто — используем
 * путь, как есть (same-origin dev без песочницы).
 */
export const SANDBOX_BASE_URL = (process.env.NEXT_PUBLIC_SANDBOX_URL ?? '').replace(/\/+$/, '');

/** Публичный адрес страницы: абсолютный из API или собранный из базы песочницы. */
export function sandboxPageUrl(sandboxUrl: string): string {
  if (/^https?:\/\//i.test(sandboxUrl)) return sandboxUrl;
  const path = sandboxUrl.startsWith('/') ? sandboxUrl : `/sandbox/${sandboxUrl}`;
  return `${SANDBOX_BASE_URL}${path}`;
}

/** Ошибка загрузки файла на клиенте (до похода на сервер). */
export type HtmlFileErrorCode = 'too_large' | 'read_failed';

export class HtmlFileError extends Error {
  constructor(readonly code: HtmlFileErrorCode) {
    super(code);
    this.name = 'HtmlFileError';
  }
}

/** Читает выбранный .html файл с проверкой размера 2 МБ (ТЗ §3.8). */
export async function readHtmlFile(file: File, maxBytes: number): Promise<string> {
  if (file.size > maxBytes) throw new HtmlFileError('too_large');
  try {
    return await file.text();
  } catch {
    throw new HtmlFileError('read_failed');
  }
}

/** Загрузка .html во внешний вид: multipart/form-data с CSRF-заголовком. */
async function uploadHtmlFile(file: File): Promise<HtmlPageResponse> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const token = await ensureCsrf(attempt > 1);
    const form = new FormData();
    form.append('file', file);

    const response = await fetch(`${API_BASE_URL}/api/html-page/upload`, {
      method: 'POST',
      credentials: 'include',
      headers: csrfHeader(token),
      body: form,
    });

    if (response.status === 403 && attempt === 1) {
      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as { code?: string } | null;
      if (body?.code === 'csrf_failed') continue;
    }

    if (!response.ok) throw await parseAuthError(response);
    return (await response.json()) as HtmlPageResponse;
  }

  throw new AuthApiError(403, 'csrf_failed', 'Не удалось обновить CSRF-токен');
}

export const htmlPageApi = {
  /** Текущая страница пользователя (exists=false — ещё не создана). */
  get: () => authFetch<HtmlPageResponse>('/api/html-page'),

  /** Сохраняет код (PUT) — создаёт новую версию, возвращает автопроверку. */
  save: (input: HtmlPageSaveValues) =>
    authFetch<HtmlPageResponse>('/api/html-page', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  /** Загружает готовый .html файл (создаёт версию). */
  upload: (file: File) => uploadHtmlFile(file),

  /** Последние 10 версий с откатом (ТЗ §3.8). */
  versions: () => authFetch<HtmlPageVersionsResponse>('/api/html-page/versions'),

  /** Откат к версии — создаёт новую версию из выбранной. */
  restore: (versionId: string) =>
    authFetch<HtmlPageResponse>(`/api/html-page/versions/${versionId}/restore`, {
      method: 'POST',
    }),

  /** Удаляет страницу вместе с историей. */
  remove: () => authFetch<void>('/api/html-page', { method: 'DELETE' }),
};
