// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент карточки «Поделиться результатом» (ТЗ §3.7): тянет PNG/предпросмотр
 * через API под cookie-сессией. GET-запрос, CSRF не нужен.
 */
import type { Locale, ShareCardFormat, ShareCardType } from '@puls/shared';
import { API_BASE_URL } from './api';

export interface ShareCardRequest {
  type: ShareCardType;
  /** id цели или код достижения (не нужен для стрика и настроения). */
  id?: string;
  format?: ShareCardFormat;
  locale?: Locale;
  /** Показывать суммы (по умолчанию только проценты, ТЗ §3.7). */
  amounts?: boolean;
}

function buildQuery(request: ShareCardRequest): string {
  const params = new URLSearchParams();
  params.set('type', request.type);
  if (request.id) params.set('id', request.id);
  if (request.format) params.set('format', request.format);
  if (request.locale) params.set('locale', request.locale);
  params.set('amounts', request.amounts ? '1' : '0');
  return params.toString();
}

/** URL SVG-карточки (для предпросмотра браузером). */
export function shareCardSvgUrl(request: ShareCardRequest): string {
  return `${API_BASE_URL}/api/share/card?${buildQuery(request)}`;
}

/** URL PNG-карточки (готова к скачиванию и публикации). */
export function shareCardPngUrl(request: ShareCardRequest): string {
  return `${API_BASE_URL}/api/share/card.png?${buildQuery(request)}`;
}

/** Скачивает PNG-карточку под текущей сессией. */
export async function fetchShareCardPng(request: ShareCardRequest): Promise<Blob> {
  const response = await fetch(shareCardPngUrl(request), { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`share_card_${response.status}`);
  }
  return response.blob();
}

/** Имя файла для скачивания. */
export function shareCardFilename(request: ShareCardRequest): string {
  const format = request.format ?? 'story';
  return `puls-${request.type}-${format}.png`;
}
