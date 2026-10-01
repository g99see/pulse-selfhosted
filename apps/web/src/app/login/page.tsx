// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { LoginSchema, isTwoFactorRequired } from '@puls/shared';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Card, Field, PrimaryButton } from '@/components/ui';
import { ProviderButtons } from '@/components/provider-buttons';
import { SetupGuard } from '@/components/setup-guard';
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
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

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
      const result = await authApi.login(parsed.data);
      // Включена 2FA — переходим к шагу ввода кода (ТЗ §6).
      if (isTwoFactorRequired(result)) {
        setChallengeToken(result.challengeToken);
        return;
      }
      const me = await authApi.me();
      router.push(me.onboardingCompleted ? '/app' : '/onboarding');
    } catch (thrown) {
      const code_ = thrown instanceof AuthApiError ? thrown.code : 'unknown_error';
      setUnverified(code_ === 'email_not_verified');
      setError(t(authErrorKey(code_)));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!challengeToken) return;
    setError(null);
    setBusy(true);
    try {
      await authApi.loginTwoFactor(challengeToken, code);
      const me = await authApi.me();
      router.push(me.onboardingCompleted ? '/app' : '/onboarding');
    } catch (thrown) {
      const code_ = thrown instanceof AuthApiError ? thrown.code : 'unknown_error';
      setError(t(authErrorKey(code_)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell brand={t('landing.brand')}>
      <SetupGuard />
      <header className="flex flex-col gap-2 text-center">
        <h1 className="font-heading text-3xl font-extrabold">{t('auth.login.title')}</h1>
        <p className="text-[var(--puls-ink-muted)]">{t('auth.login.subtitle')}</p>
      </header>

      {challengeToken ? (
        <Card>
          <form className="flex flex-col gap-4" onSubmit={onSubmitCode} noValidate>
            <h2 className="text-lg font-bold">{t('auth.login.2fa.title')}</h2>
            <p className="text-sm text-[var(--puls-ink-muted)]">{t('auth.login.2fa.hint')}</p>
            <Field
              id="two-factor-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              name="code"
              label={t('auth.login.2fa.code')}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />

            {error ? <Alert>{error}</Alert> : null}

            <PrimaryButton type="submit" disabled={busy}>
              {busy ? t('common.loading') : t('auth.login.2fa.submit')}
            </PrimaryButton>
          </form>
        </Card>
      ) : (
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

          <div className="mt-5">
            <ProviderButtons />
          </div>
        </Card>
      )}

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
    <Link href="/" className="text-center text-sm text-[var(--puls-ink-muted)] hover:text-[var(--puls-ink)]">
        ← {t('app.nav.home')}
      </Link>
    </AuthShell>
  );
}
