// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент экспорта и удаления аккаунта (ТЗ §3.1, §6). Выгрузка скачивается
 * файлом (JSON или ZIP с CSV), удаление идёт через authFetch — с cookie-сессией
 * и CSRF-заголовком.
 */
import type { DeleteAccountInput, ExportFormat } from '@puls/shared';
import { API_BASE_URL } from './api';
import { authFetch, parseAuthError } from './auth-client';

/** Расширение файла выгрузки: CSV отдаётся ZIP-архивом. */
export function exportFileExtension(format: ExportFormat): string {
  return format === 'csv' ? 'zip' : 'json';
}

/** Имя файла из Content-Disposition: сначала RFC 5987, затем ASCII-вариант. */
export function filenameFromDisposition(disposition: string): string | undefined {
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  return /filename="([^"]+)"/i.exec(disposition)?.[1];
}

/** Сохраняет blob как файл, не уводя пользователя со страницы. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function downloadExport(format: ExportFormat): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/account/export?format=${format}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) throw await parseAuthError(response);

  const blob = await response.blob();
  const filename =
    filenameFromDisposition(response.headers.get('content-disposition') ?? '') ??
    `puls-export.${exportFileExtension(format)}`;
  saveBlob(blob, filename);
}

export const accountApi = {
  exportJson: () => downloadExport('json'),
  exportCsv: () => downloadExport('csv'),
  deleteAccount: (input: DeleteAccountInput) =>
    authFetch<void>('/api/account', { method: 'DELETE', body: JSON.stringify(input) }),
};
