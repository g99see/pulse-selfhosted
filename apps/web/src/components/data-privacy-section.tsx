// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DeleteAccountSchema } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, Card, Field, GhostButton, PrimaryButton } from '@/components/ui';
import { accountApi } from '@/lib/account-client';
import { AuthApiError } from '@/lib/auth-client';

/**
 * Секция «Данные и приватность» (ТЗ §3.1, §6, §9): выгрузка всех данных
 * (JSON и ZIP с CSV) и полное удаление аккаунта с подтверждением в модальном
 * окне (пароль + никнейм). Живёт на странице /settings.
 */
export function DataPrivacySection() {
  const { t } = useT();
  const router = useRouter();

  const [busy, setBusy] = useState<'json' | 'csv' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function download(format: 'json' | 'csv'): Promise<void> {
    setBusy(format);
    setStatus(null);
    setError(null);
    try {
      if (format === 'csv') await accountApi.exportCsv();
      else await accountApi.exportJson();
      setStatus(t('settings.data.exported'));
    } catch (caught) {
      setError(caught instanceof AuthApiError ? caught.message : t('settings.data.error'));
    } finally {
      setBusy(null);
    }
  }

  function closeConfirm(): void {
    setConfirmOpen(false);
    setDeleteError(null);
  }

  async function submitDelete(): Promise<void> {
    setDeleteError(null);

    const parsed = DeleteAccountSchema.safeParse({ password, confirm });
    if (!parsed.success) {
      setDeleteError(t('settings.data.delete.invalid'));
      return;
    }

    setDeleting(true);
    try {
      await accountApi.deleteAccount(parsed.data);
      router.push('/login');
    } catch (caught) {
      if (caught instanceof AuthApiError) {
        if (caught.code === 'invalid_password')
          setDeleteError(t('settings.data.delete.wrongPassword'));
        else if (caught.code === 'confirmation_mismatch')
          setDeleteError(t('settings.data.delete.mismatch'));
        else setDeleteError(caught.message);
      } else {
        setDeleteError(t('settings.data.error'));
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-bold">{t('settings.data.title')}</h2>
        <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('settings.data.hint')}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <GhostButton
          type="button"
          data-testid="export-json"
          disabled={busy !== null}
          onClick={() => void download('json')}
        >
          {busy === 'json' ? t('settings.data.exporting') : t('settings.data.exportJson')}
        </GhostButton>
        <GhostButton
          type="button"
          data-testid="export-csv"
          disabled={busy !== null}
          onClick={() => void download('csv')}
        >
          {busy === 'csv' ? t('settings.data.exporting') : t('settings.data.exportCsv')}
        </GhostButton>
      </div>

      {status ? <Alert tone="success">{status}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}

      <hr className="border-[var(--puls-line)]" />

      <div>
        <h3 className="font-semibold text-[var(--puls-warning-text)]">
          {t('settings.data.delete.title')}
        </h3>
        <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">
          {t('settings.data.delete.hint')}
        </p>
        <button
          type="button"
          data-testid="delete-account-open"
          onClick={() => setConfirmOpen(true)}
          className="mt-3 h-12 rounded-[var(--radius-button)] border border-[var(--puls-warning)] px-6 font-semibold text-[var(--puls-warning-text)] transition-opacity hover:opacity-80"
        >
          {t('settings.data.delete.open')}
        </button>
      </div>

      {confirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          data-testid="delete-account-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-lg">
            <h3 id="delete-account-title" className="text-lg font-bold">
              {t('settings.data.delete.title')}
            </h3>
            <p className="mt-2 text-sm text-[var(--puls-ink-muted)]">
              {t('settings.data.delete.warning')}
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <Field
                id="delete-account-password"
                type="password"
                label={t('settings.data.delete.password')}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Field
                id="delete-account-confirm"
                label={t('settings.data.delete.confirm')}
                hint={t('settings.data.delete.confirmHint')}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>

            {deleteError ? (
              <div className="mt-3">
                <Alert>{deleteError}</Alert>
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-3">
              <GhostButton type="button" onClick={closeConfirm} disabled={deleting}>
                {t('settings.data.delete.cancel')}
              </GhostButton>
              <PrimaryButton
                type="button"
                data-testid="delete-account-confirm"
                onClick={() => void submitDelete()}
                disabled={deleting}
              >
                {deleting
                  ? t('settings.data.delete.deleting')
                  : t('settings.data.delete.confirmButton')}
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
