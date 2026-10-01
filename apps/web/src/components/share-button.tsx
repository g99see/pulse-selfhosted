// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShareCardFormat, ShareCardType } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { fetchShareCardPng, shareCardFilename, type ShareCardRequest } from '@/lib/share-client';

export interface ShareButtonProps {
  type: ShareCardType;
  /** id цели или код достижения (не нужен для стрика и настроения). */
  id?: string;
  /** Готовый текст для соцсетей (переводит родитель через t()). */
  shareText: string;
  label?: string;
  className?: string;
}

/** Проверка поддержки Web Share API с файлами (ТЗ §3.7). */
function canShareFiles(file: File): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  return (
    typeof nav.share === 'function' &&
    typeof nav.canShare === 'function' &&
    nav.canShare({ files: [file] })
  );
}

/**
 * Кнопка «Поделиться результатом» (ТЗ §3.7, §4 P1): открывает предпросмотр
 * карточки, делится PNG через Web Share API, а при его отсутствии — скачивает
 * файл и предлагает открыть в Telegram.
 */
export function ShareButton({ type, id, shareText, label, className }: ShareButtonProps) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ShareCardFormat>('story');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<File | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const request: ShareCardRequest = { type, id, format, locale };

  const revoke = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    revoke();
    try {
      const blob = await fetchShareCardPng(request);
      const file = new File([blob], shareCardFilename(request), { type: 'image/png' });
      fileRef.current = file;
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setPreviewUrl(url);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [type, id, format, locale, revoke]);

  useEffect(() => {
    if (open) void load();
  }, [open, format, load]);

  useEffect(() => () => revoke(), [revoke]);

  const close = useCallback(() => {
    setOpen(false);
    setStatus('idle');
    setPreviewUrl(null);
    fileRef.current = null;
    revoke();
  }, [revoke]);

  const download = useCallback(() => {
    if (!previewUrl) return;
    const anchor = document.createElement('a');
    anchor.href = previewUrl;
    anchor.download = shareCardFilename(request);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }, [previewUrl, request]);

  const share = useCallback(async (): Promise<void> => {
    const file = fileRef.current;
    if (!file) return;
    if (canShareFiles(file)) {
      try {
        await navigator.share({ files: [file], title: t('share.sheet.title'), text: shareText });
        return;
      } catch {
        // Пользователь отменил — остаёмся в предпросмотре.
        return;
      }
    }
    // Fallback: скачиваем файл (ТЗ §3.7: растеризация на клиенте не нужна —
    // PNG приходит с сервера, браузер только сохраняет).
    download();
  }, [download, shareText, t]);

  const telegram = useCallback(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `https://t.me/share/url?url=${encodeURIComponent(origin)}&text=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [shareText]);

  const testId = id ? `share-${type}-${id}` : `share-${type}`;

  return (
    <>
      <button
        type="button"
        data-testid={testId}
        onClick={() => setOpen(true)}
        className={
          className ??
          'h-9 rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-4 text-xs font-semibold text-[var(--puls-primary-text)] transition-colors hover:opacity-90'
        }
      >
        {label ?? t('share.button')}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('share.sheet.title')}
          data-testid="share-sheet"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-sm flex-col gap-4 overflow-auto rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold">{t('share.sheet.title')}</h2>
              <button
                type="button"
                data-testid="share-close"
                onClick={close}
                className="text-sm text-[var(--puls-ink-muted)]"
              >
                {t('share.close')}
              </button>
            </div>

            <div className="flex gap-2" role="group" aria-label={t('share.preview')}>
              {(['story', 'square'] as ShareCardFormat[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`share-format-${value}`}
                  aria-pressed={format === value}
                  onClick={() => setFormat(value)}
                  className={`h-9 flex-1 rounded-[var(--radius-button)] border px-3 text-xs font-semibold ${
                    format === value
                      ? 'border-[var(--puls-primary)] bg-[var(--puls-primary)] text-[var(--puls-on-primary)]'
                      : 'border-[var(--puls-line-strong)] text-[var(--puls-ink)]'
                  }`}
                >
                  {t(`share.format.${value}`)}
                </button>
              ))}
            </div>

            <div className="flex min-h-40 items-center justify-center rounded-[var(--radius-button)] bg-[var(--puls-bg)] p-2">
              {status === 'loading' ? (
                <p className="text-sm text-[var(--puls-ink-muted)]" data-testid="share-loading">
                  {t('share.loading')}
                </p>
              ) : null}
              {status === 'error' ? (
                <p
                  role="alert"
                  className="text-sm text-[var(--puls-warning-text)]"
                  data-testid="share-error"
                >
                  {t('share.error')}
                </p>
              ) : null}
              {status === 'ready' && previewUrl ? (
                <img
                  src={previewUrl}
                  alt={t('share.imageAlt')}
                  data-testid="share-preview"
                  className="max-h-72 w-auto rounded-[var(--radius-button)]"
                />
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                data-testid="share-submit"
                disabled={status !== 'ready'}
                onClick={() => void share()}
                className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
              >
                {t('share.share')}
              </button>
              <a
                data-testid="share-download"
                href={previewUrl ?? '#'}
                download={shareCardFilename(request)}
                onClick={(event) => {
                  if (!previewUrl) {
                    event.preventDefault();
                    return;
                  }
                  event.preventDefault();
                  download();
                }}
                className="flex h-11 items-center justify-center rounded-[var(--radius-button)] bg-[var(--puls-finance-soft)] px-4 text-sm font-semibold text-[var(--puls-finance-text)]"
              >
                {t('share.download')}
              </a>
              <button
                type="button"
                data-testid="share-telegram"
                onClick={telegram}
                className="flex h-11 items-center justify-center rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] px-4 text-sm font-semibold text-[var(--puls-ink)]"
              >
                {t('share.telegram')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
