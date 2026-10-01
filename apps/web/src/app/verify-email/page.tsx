// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Card, Field, PrimaryButton } from '@/components/ui';
import { useT } from '@/components/locale-provider';
import { authApi } from '@/lib/auth-client';
import { useQueryParams } from '@/lib/use-query';

type Status = 'idle' | 'checking' | 'ok' | 'failed';

export default function VerifyEmailPage() {
  const { t } = useT();
  const router = useRouter();
  const { ready, get } = useQueryParams();
  const started = useRef(false);

  const [status, setStatus] = useState<Status>('idle');
  const [email, setEmail] = useState('');
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  const token = get('token');
  const emailFromQuery = get('email');

  useEffect(() => {
    if (emailFromQuery) setEmail(emailFromQuery);
  }, [emailFromQuery]);

  useEffect(() => {
    if (!ready || !token || started.current) return;
    started.current = true;

    setStatus('checking');
    authApi
      .verifyEmail(token)
      .then(async () => {
        setStatus('ok');
        const me = await authApi.me();
        router.replace(me.onboardingCompleted ? '/app' : '/onboarding');
      })
      .catch(() => setStatus('failed'));
  }, [ready, token, router]);

  async function onResend(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!email) return;
    setBusy(true);
    setResent(false);
    try {
      await authApi.resendVerification(email);
      setResent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell brand={t('landing.brand')}>
      <header className="flex flex-col gap-2 text-center">
        <h1 className="font-heading text-3xl font-extrabold">{t('auth.verify.title')}</h1>
      </header>

      <Card>
        {status === 'checking' ? (
          <p role="status" className="text-[var(--puls-ink-muted)]">
            {t('auth.verify.checking')}
          </p>
        ) : null}
        {status === 'ok' ? <Alert tone="success">{t('auth.verify.success')}</Alert> : null}
        {status === 'failed' ? <Alert>{t('auth.verify.failed')}</Alert> : null}

        {status !== 'checking' ? (
          <form className="mt-4 flex flex-col gap-4" onSubmit={onResend} noValidate>
            <p className="text-sm text-[var(--puls-ink-muted)]">{t('auth.verify.needEmail')}</p>
            <Field
              id="email"
              type="email"
              name="email"
              autoComplete="email"
              label={t('auth.register.email')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {resent ? <Alert tone="success">{t('auth.verify.resent')}</Alert> : null}
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? t('common.loading') : t('auth.verify.resend')}
            </PrimaryButton>
          </form>
        ) : null}
      </Card>

      <Link href="/login" className="text-center text-sm font-semibold text-[var(--puls-primary-text)]">
        {t('auth.verify.goLogin')}
      </Link>
    <Link href="/" className="text-center text-sm text-[var(--puls-ink-muted)] hover:text-[var(--puls-ink)]">
        ← {t('app.nav.home')}
      </Link>
    </AuthShell>
  );
}
