// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useState } from 'react';
import {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  ReportCreateSchema,
  type ReportReason,
  type ReportTargetType,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { AuthApiError } from '@/lib/auth-client';
import { reportApi } from '@/lib/moderation-client';

/** Известные коды ошибок приёма жалоб → ключи перевода. */
const ERROR_KEYS: Record<string, string> = {
  report_duplicate: 'report.error.duplicate',
  report_self: 'report.error.report_self',
  rate_limited: 'report.error.rate_limited',
};

export interface ReportButtonProps {
  /** Тип цели: профиль, пост, комментарий или HTML-страница (ТЗ §3.7). */
  targetType: ReportTargetType;
  /** Идентификатор цели (id пользователя, поста, комментария или страницы). */
  targetId: string;
  /** Скрыть кнопку (например, на собственном профиле). */
  hidden?: boolean;
  className?: string;
}

/**
 * Кнопка «Пожаловаться» с диалогом (ТЗ §3.7). Подключается блоками профиля,
 * ленты и HTML-страницы: `<ReportButton targetType="post" targetId={post.id} />`.
 */
export function ReportButton({ targetType, targetId, hidden, className = '' }: ReportButtonProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hidden) return null;

  function close(): void {
    setOpen(false);
    setBusy(false);
    setError(null);
    if (done) {
      setDone(false);
      setDetails('');
      setReason('spam');
    }
  }

  async function submit(): Promise<void> {
    const parsed = ReportCreateSchema.safeParse({
      targetType,
      targetId,
      reason,
      details: details.trim().length > 0 ? details.trim() : undefined,
    });
    if (!parsed.success) {
      setError(t('report.error.generic'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await reportApi.create(parsed.data);
      setDone(true);
    } catch (caught) {
      const code = caught instanceof AuthApiError ? caught.code : 'unknown';
      setError(t(ERROR_KEYS[code] ?? 'report.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        data-testid="report-open"
        onClick={() => setOpen(true)}
        className="rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] px-3 py-1.5 text-xs font-medium text-[var(--puls-ink-muted)] transition-colors hover:bg-[var(--puls-ink-muted)]/10"
      >
        {t('report.button')}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('report.dialog.title')}
          data-testid="report-dialog"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
        >
          <div className="w-full max-w-md rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-lg">
            <h2 className="text-lg font-bold">{t('report.dialog.title')}</h2>
            <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('report.dialog.hint')}</p>

            {done ? (
              <div className="mt-4 flex flex-col gap-3">
                <p role="status" data-testid="report-success" className="text-sm font-medium text-[var(--puls-finance-text)]">
                  {t('report.success')}
                </p>
                <button
                  type="button"
                  data-testid="report-cancel"
                  onClick={close}
                  className="rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 py-2 text-sm font-semibold text-[var(--puls-on-primary)]"
                >
                  {t('report.dialog.cancel')}
                </button>
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  {t('report.dialog.reason')}
                  <select
                    data-testid="report-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value as ReportReason)}
                    className="h-11 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                  >
                    {REPORT_REASONS.map((value) => (
                      <option key={value} value={value}>
                        {t(`report.reason.${value}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  {t('report.dialog.details')}
                  <textarea
                    data-testid="report-details"
                    value={details}
                    maxLength={REPORT_DETAILS_MAX}
                    onChange={(event) => setDetails(event.target.value)}
                    rows={3}
                    className="rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] p-3"
                  />
                  <span className="text-xs text-[var(--puls-ink-muted)]">{t('report.dialog.detailsHint')}</span>
                </label>

                {error ? (
                  <p role="alert" className="text-sm text-[var(--puls-warning-text)]">
                    {error}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    data-testid="report-cancel"
                    onClick={close}
                    disabled={busy}
                    className="rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {t('report.dialog.cancel')}
                  </button>
                  <button
                    type="button"
                    data-testid="report-submit"
                    onClick={() => void submit()}
                    disabled={busy}
                    className="rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 py-2 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
                  >
                    {t('report.dialog.submit')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
