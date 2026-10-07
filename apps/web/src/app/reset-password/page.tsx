// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PasswordTokenSchema, type PasswordTokenInfo } from '@puls/shared';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Card, Field, PrimaryButton } from '@/components/ui';
import { useT } from '@/components/locale-provider';
import { AuthApiError, authApi } from '@/lib/auth-client';
import { authErrorKey } from '@/lib/i18n';
import { useQueryParams } from '@/lib/use-query';

type Status = 'loading' | 'ready' | 'invalid' | 'done';

/**
 * Установка/сброс пароля по ссылке из письма или сообщения бота (v3 §7):
 * токен в query, при `purpose: setup` можно сразу задать логин. Успех завершает
 * прочие сессии и выдаёт текущую — ведём на онбординг или в кабинет.
 */
export default function ResetPasswordPage() {
  const { t } = useT();
  const router = useRouter();
  const { ready, get } = useQueryParams();
  const started = useRef(false);
  const token = get('token');

  const [status, setStatus] = useState<Status>('loading');
  const [info, setInfo] = useState<PasswordTokenInfo | null>(null);
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;

    if (!token) {
      setStatus('invalid');
      return;
    }

    authApi
      .passwordToken(token)
      .then((result) => {
        if (!result.valid) {
          setStatus('invalid');
          return;
        }
        setInfo(result);
        setNickname(result.nickname ?? '');
        setStatus('ready');
      })
      .catch(() => setStatus('invalid'));
  }, [ready, token]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!token || !info) return;

    const parsed = PasswordTokenSchema.safeParse({
      token,
      password,
      passwordConfirm,
      ...(info.purpose === 'setup' ? { nickname } : {}),
    });
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
      await authApi.resetPassword(parsed.data);
      setStatus('done');
      const me = await authApi.me();
      router.push(me.onboardingCompleted ? '/app' : '/onboarding');
    } catch (thrown) {
      setError(t(authErrorKey(thrown instanceof AuthApiError ? thrown.code : 'unknown_error')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell brand={t('landing.brand')}>
      <header className="flex flex-col gap-2 text-center">
        <h1 className="font-heading text-2xl font-extrabold">{t('auth.reset.title')}</h1>
        {status !== 'invalid' ? (
          <p className="text-[var(--puls-ink-muted)]">{t('auth.reset.subtitle')}</p>
        ) : null}
      </header>

      <Card>
        {status === 'loading' ? (
          <p role="status" className="text-[var(--puls-ink-muted)]">
            {t('auth.reset.loading')}
          </p>
        ) : null}

        {status === 'invalid' ? <Alert>{t('auth.reset.invalid')}</Alert> : null}

        {status === 'done' ? <Alert tone="success">{t('auth.reset.done')}</Alert> : null}

        {status === 'ready' ? (
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            {info?.purpose === 'setup' ? (
              <Field
                id="nickname"
                type="text"
                name="nickname"
                autoComplete="username"
                label={t('auth.reset.nickname')}
                hint={t('auth.reset.nicknameHint')}
                value={nickname}
                error={fieldErrors.nickname}
                onChange={(event) => setNickname(event.target.value)}
              />
            ) : null}
            <Field
              id="password"
              type="password"
              name="password"
              autoComplete="new-password"
              label={t('auth.reset.password')}
              value={password}
              error={fieldErrors.password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Field
              id="passwordConfirm"
              type="password"
              name="passwordConfirm"
              autoComplete="new-password"
              label={t('auth.reset.passwordConfirm')}
              value={passwordConfirm}
              error={fieldErrors.passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
            />

            {error ? <Alert>{error}</Alert> : null}

            <PrimaryButton type="submit" disabled={busy}>
              {busy ? t('common.loading') : t('auth.reset.submit')}
            </PrimaryButton>
          </form>
        ) : null}
      </Card>

      <Link
        href="/login"
        className="text-center text-sm font-semibold text-[var(--puls-primary-text)]"
      >
        {t('auth.reset.back')}
      </Link>
    </AuthShell>
  );
}
