// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { RegisterSchema } from '@puls/shared';
import { Alert, Card, Field, PrimaryButton } from '@/components/ui';
import { useT } from '@/components/locale-provider';
import { AuthApiError, authApi } from '@/lib/auth-client';
import { authErrorKey } from '@/lib/i18n';

export default function RegisterPage() {
  const { t } = useT();
  const router = useRouter();
  const [values, setValues] = useState({ email: '', password: '', nickname: '' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const parsed = RegisterSchema.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0] ?? ''), issue.message]),
        ),
      );
      return;
    }

    setBusy(true);
    try {
      await authApi.register(parsed.data);
      router.push(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`);
    } catch (thrown) {
      setError(t(authErrorKey(thrown instanceof AuthApiError ? thrown.code : 'unknown_error')));
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
        <h1 className="text-3xl font-extrabold">{t('auth.register.title')}</h1>
        <p className="text-[var(--puls-ink-muted)]">{t('auth.register.subtitle')}</p>
      </header>

      <Card>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Field
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            label={t('auth.register.email')}
            value={values.email}
            error={fieldErrors.email}
            onChange={(event) => setValues({ ...values, email: event.target.value })}
          />
          <Field
            id="password"
            type="password"
            name="password"
            autoComplete="new-password"
            label={t('auth.register.password')}
            hint={t('auth.register.passwordHint')}
            value={values.password}
            error={fieldErrors.password}
            onChange={(event) => setValues({ ...values, password: event.target.value })}
          />
          <Field
            id="nickname"
            type="text"
            name="nickname"
            autoComplete="username"
            label={t('auth.register.nickname')}
            hint={t('auth.register.nicknameHint')}
            value={values.nickname}
            error={fieldErrors.nickname}
            onChange={(event) => setValues({ ...values, nickname: event.target.value })}
          />

          {error ? <Alert>{error}</Alert> : null}

          <PrimaryButton type="submit" disabled={busy}>
            {busy ? t('common.loading') : t('auth.register.submit')}
          </PrimaryButton>
        </form>
      </Card>

      <p className="text-center text-sm text-[var(--puls-ink-muted)]">
        {t('auth.register.haveAccount')}{' '}
        <Link href="/login" className="font-semibold text-[var(--puls-primary-text)]">
          {t('auth.register.goLogin')}
        </Link>
      </p>
    </main>
  );
}
