// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/components/locale-provider';
import { Alert, Card, Field, GhostButton, PrimaryButton } from '@/components/ui';
import { authApi, AuthApiError } from '@/lib/auth-client';
import { authErrorKey } from '@/lib/i18n';

interface SetupData {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string | null;
}

/**
 * Секция «Двухфакторная аутентификация» (ТЗ §6) на экране настроек:
 * включение по QR/секрету с подтверждением кодом и выдачей резервных кодов,
 * а также выключение по паролю и коду.
 */
export function TwoFactorSection() {
  const { t } = useT();

  const [status, setStatus] = useState<{ enabled: boolean; available: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [setup, setSetup] = useState<SetupData | null>(null);
  const [enableCode, setEnableCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const [password, setPassword] = useState('');
  const [disableCode, setDisableCode] = useState('');

  const message = useCallback(
    (thrown: unknown): string => {
      if (thrown instanceof AuthApiError) return t(authErrorKey(thrown.code));
      return t('settings.twoFactor.error');
    },
    [t],
  );

  const load = useCallback(async () => {
    try {
      setStatus(await authApi.twoFactorStatus());
    } catch (thrown) {
      setError(message(thrown));
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  async function startSetup(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setSetup(await authApi.twoFactorSetup());
      setEnableCode('');
      setBackupCodes(null);
    } catch (thrown) {
      setError(message(thrown));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.twoFactorEnable(enableCode);
      setBackupCodes(result.backupCodes);
      setSetup(null);
      await load();
    } catch (thrown) {
      setError(message(thrown));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await authApi.twoFactorDisable(password, disableCode);
      setPassword('');
      setDisableCode('');
      await load();
    } catch (thrown) {
      setError(message(thrown));
    } finally {
      setBusy(false);
    }
  }

  if (status === null) {
    return (
      <Card className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">{t('settings.twoFactor.title')}</h2>
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('common.loading')}</p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-bold">{t('settings.twoFactor.title')}</h2>
        <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('settings.twoFactor.hint')}</p>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      {!status.available ? (
        <Alert>{t('settings.twoFactor.unavailable')}</Alert>
      ) : status.enabled ? (
        <div className="flex flex-col gap-3" data-testid="two-factor-enabled">
          <Alert tone="success">{t('settings.twoFactor.enabled')}</Alert>
          <p className="text-sm text-[var(--puls-ink-muted)]">{t('settings.twoFactor.disableHint')}</p>
          <Field
            id="two-factor-disable-password"
            type="password"
            autoComplete="current-password"
            label={t('settings.twoFactor.password')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Field
            id="two-factor-disable-code"
            label={t('settings.twoFactor.code')}
            value={disableCode}
            onChange={(event) => setDisableCode(event.target.value)}
          />
          <div>
            <GhostButton
              type="button"
              data-testid="two-factor-disable"
              disabled={busy}
              onClick={() => void confirmDisable()}
            >
              {t('settings.twoFactor.disable')}
            </GhostButton>
          </div>
        </div>
      ) : backupCodes ? (
        <div className="flex flex-col gap-3" data-testid="two-factor-backup">
          <p className="text-sm font-medium">{t('settings.twoFactor.backupHint')}</p>
          <ul
            data-testid="backup-codes"
            className="grid grid-cols-2 gap-1 rounded-[var(--radius-button)] bg-[var(--puls-bg)] p-3 font-mono text-sm"
          >
            {backupCodes.map((backup) => (
              <li key={backup}>{backup}</li>
            ))}
          </ul>
          <Alert tone="success">{t('settings.twoFactor.backupDone')}</Alert>
        </div>
      ) : setup ? (
        <div className="flex flex-col gap-3" data-testid="two-factor-setup">
          <p className="text-sm text-[var(--puls-ink-muted)]">{t('settings.twoFactor.setupHint')}</p>
          {setup.qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={setup.qrDataUrl}
              alt={t('settings.twoFactor.qrAlt')}
              width={200}
              height={200}
              className="rounded-[var(--radius-button)] bg-white p-2"
            />
          ) : null}
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--puls-ink-muted)]">{t('settings.twoFactor.secret')}</span>
            <code data-testid="two-factor-secret" className="break-all font-mono">
              {setup.secret}
            </code>
          </div>
          <Field
            id="two-factor-enable-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            label={t('settings.twoFactor.code')}
            hint={t('settings.twoFactor.codeHint')}
            value={enableCode}
            onChange={(event) => setEnableCode(event.target.value)}
          />
          <div className="flex gap-3">
            <PrimaryButton
              type="button"
              data-testid="two-factor-enable"
              disabled={busy}
              onClick={() => void confirmEnable()}
            >
              {t('settings.twoFactor.confirm')}
            </PrimaryButton>
            <GhostButton type="button" disabled={busy} onClick={() => setSetup(null)}>
              {t('common.back')}
            </GhostButton>
          </div>
        </div>
      ) : (
        <div>
          <PrimaryButton
            type="button"
            data-testid="two-factor-start"
            disabled={busy}
            onClick={() => void startSetup()}
          >
            {t('settings.twoFactor.enable')}
          </PrimaryButton>
        </div>
      )}

      {backupCodes ? (
        <GhostButton type="button" onClick={() => setBackupCodes(null)}>
          {t('settings.twoFactor.done')}
        </GhostButton>
      ) : null}
    </Card>
  );
}
