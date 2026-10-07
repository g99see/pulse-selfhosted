// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ForgotPasswordSchema } from '@puls/shared';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Card, Field, PrimaryButton } from '@/components/ui';
import { useT } from '@/components/locale-provider';
import { AuthApiError, authApi } from '@/lib/auth-client';
import { authErrorKey } from '@/lib/i18n';

/**
 * Запрос ссылки восстановления пароля (v3 §7): вводим логин или почту.
 * Ответ всегда одинаков — не раскрываем, есть ли такой пользователь.
 */
export default function ForgotPasswordPage() {
  const { t } = useT();
  const [login, setLogin] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const parsed = ForgotPasswordSchema.safeParse({ login });
    if (!parsed.success) {
      setError(t('auth.error.generic'));
      return;
    }

    setBusy(true);
    try {
      await authApi.forgotPassword(parsed.data);
      setSent(true);
    } catch (thrown) {
      setError(t(authErrorKey(thrown instanceof AuthApiError ? thrown.code : 'unknown_error')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell brand={t('landing.brand')}>
      <header className="flex flex-col gap-2 text-center">
        <h1 className="font-heading text-2xl font-extrabold">{t('auth.forgot.title')}</h1>
        <p className="text-[var(--puls-ink-muted)]">{t('auth.forgot.subtitle')}</p>
      </header>

      <Card>
        {sent ? (
          <Alert tone="success">{t('auth.forgot.sent')}</Alert>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <Field
              id="login"
              type="text"
              name="login"
              autoComplete="username"
              label={t('auth.forgot.login')}
              value={login}
              onChange={(event) => setLogin(event.target.value)}
            />

            {error ? <Alert>{error}</Alert> : null}

            <PrimaryButton type="submit" disabled={busy}>
              {busy ? t('common.loading') : t('auth.forgot.submit')}
            </PrimaryButton>
          </form>
        )}
      </Card>

      <Link
        href="/login"
        className="text-center text-sm font-semibold text-[var(--puls-primary-text)]"
      >
        {t('auth.forgot.back')}
      </Link>
    </AuthShell>
  );
}
