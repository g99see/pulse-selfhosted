// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { LoginSchema } from '@puls/shared';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Card, Field, PrimaryButton } from '@/components/ui';
import { ProviderButtons } from '@/components/provider-buttons';
import { SetupGuard } from '@/components/setup-guard';
import { useT } from '@/components/locale-provider';
import { AuthApiError, authApi } from '@/lib/auth-client';
import { authErrorKey } from '@/lib/i18n';

/** Вход (v3 §7.3): только логин ИЛИ почта + пароль. 2FA удалена. */
export default function LoginPage() {
  const { t } = useT();
  const router = useRouter();
  const [values, setValues] = useState({ login: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const parsed = LoginSchema.safeParse(values);
    if (!parsed.success) {
      setError(t('auth.error.generic'));
      return;
    }

    setBusy(true);
    try {
      await authApi.login(parsed.data);
      const me = await authApi.me();
      router.push(me.onboardingCompleted ? '/app' : '/onboarding');
    } catch (thrown) {
      const code = thrown instanceof AuthApiError ? thrown.code : 'unknown_error';
      setError(t(authErrorKey(code)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell brand={t('landing.brand')}>
      <SetupGuard />
      <header className="flex flex-col gap-2 text-center">
        <h1 className="font-heading text-2xl font-extrabold">{t('auth.login.title')}</h1>
        <p className="text-[var(--puls-ink-muted)]">{t('auth.login.subtitle')}</p>
      </header>

      <Card>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Field
            id="login"
            type="text"
            name="login"
            autoComplete="username"
            label={t('auth.login.login')}
            value={values.login}
            onChange={(event) => setValues({ ...values, login: event.target.value })}
          />
          <Field
            id="password"
            type="password"
            name="password"
            autoComplete="current-password"
            label={t('auth.login.password')}
            value={values.password}
            onChange={(event) => setValues({ ...values, password: event.target.value })}
          />

          {error ? <Alert>{error}</Alert> : null}

          <PrimaryButton type="submit" disabled={busy}>
            {busy ? t('common.loading') : t('auth.login.submit')}
          </PrimaryButton>
        </form>

        <p className="mt-3 text-center text-sm">
          <Link href="/forgot-password" className="font-semibold text-[var(--puls-primary-text)]">
            {t('auth.login.forgot')}
          </Link>
        </p>

        <div className="mt-5">
          <ProviderButtons />
        </div>
      </Card>

      <p className="text-center text-sm text-[var(--puls-ink-muted)]">
        {t('auth.login.noAccount')}{' '}
        <Link href="/register" className="font-semibold text-[var(--puls-primary-text)]">
          {t('auth.login.goRegister')}
        </Link>
      </p>
      <Link
        href="/"
        className="flex min-h-11 items-center justify-center text-center text-sm text-[var(--puls-ink-muted)] hover:text-[var(--puls-ink)]"
      >
        ← {t('app.nav.home')}
      </Link>
    </AuthShell>
  );
}
