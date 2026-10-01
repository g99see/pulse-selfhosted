// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { LoginSchema } from '@puls/shared';
import { Alert, Card, Field, PrimaryButton } from '@/components/ui';
import { useT } from '@/components/locale-provider';
import { AuthApiError, authApi } from '@/lib/auth-client';
import { authErrorKey } from '@/lib/i18n';

export default function LoginPage() {
  const { t } = useT();
  const router = useRouter();
  const [values, setValues] = useState({ email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setUnverified(false);

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
      setUnverified(code === 'email_not_verified');
      setError(t(authErrorKey(code)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="content" className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-10">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm font-semibold text-[var(--puls-primary-text)]">
          ← {t('app.nav.home')}
        </Link>
        <h1 className="text-3xl font-extrabold">{t('auth.login.title')}</h1>
        <p className="text-[var(--puls-ink-muted)]">{t('auth.login.subtitle')}</p>
      </header>

      <Card>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Field
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            label={t('auth.login.email')}
            value={values.email}
            onChange={(event) => setValues({ ...values, email: event.target.value })}
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
      </Card>

      {unverified ? (
        <Link
          href={`/verify-email?email=${encodeURIComponent(values.email)}`}
          className="text-center text-sm font-semibold text-[var(--puls-primary-text)]"
        >
          {t('auth.verify.resend')}
        </Link>
      ) : null}

      <p className="text-center text-sm text-[var(--puls-ink-muted)]">
        {t('auth.login.noAccount')}{' '}
        <Link href="/register" className="font-semibold text-[var(--puls-primary-text)]">
          {t('auth.login.goRegister')}
        </Link>
      </p>
    </main>
  );
}
