// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { RegisterSchema, nicknameSchema, passwordStrength } from '@puls/shared';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Card, Field, PrimaryButton } from '@/components/ui';
import { ProviderButtons } from '@/components/provider-buttons';
import { useT } from '@/components/locale-provider';
import { AuthApiError, authApi } from '@/lib/auth-client';
import { authErrorKey } from '@/lib/i18n';

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

/**
 * Регистрация (v3 §7.2): логин, пароль с повтором и подсказкой надёжности,
 * живая проверка уникальности логина, почта необязательна. Сразу выдаёт сессию,
 * поэтому после успеха ведём на онбординг.
 */
export default function RegisterPage() {
  const { t, locale } = useT();
  const router = useRouter();
  const [values, setValues] = useState({
    nickname: '',
    email: '',
    password: '',
    passwordConfirm: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [availability, setAvailability] = useState<Availability>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const strength = passwordStrength(values.password);

  // Живая проверка уникальности логина с лёгким дебаунсом.
  useEffect(() => {
    const nickname = values.nickname.trim().toLowerCase();
    if (nickname.length === 0) {
      setAvailability('idle');
      return;
    }
    if (!nicknameSchema.safeParse(nickname).success) {
      setAvailability('invalid');
      return;
    }

    let active = true;
    setAvailability('checking');
    const timer = setTimeout(() => {
      authApi
        .nicknameAvailable(nickname)
        .then((result) => {
          if (!active) return;
          if (result.available) setAvailability('available');
          else setAvailability(result.reason === 'invalid' ? 'invalid' : 'taken');
        })
        .catch(() => {
          if (active) setAvailability('idle');
        });
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [values.nickname]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const parsed = RegisterSchema.safeParse({
      nickname: values.nickname,
      password: values.password,
      passwordConfirm: values.passwordConfirm,
      email: values.email.trim() === '' ? undefined : values.email,
      locale,
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
      await authApi.register(parsed.data);
      router.push('/onboarding');
    } catch (thrown) {
      const code = thrown instanceof AuthApiError ? thrown.code : 'unknown_error';
      if (code === 'nickname_taken') setAvailability('taken');
      setError(t(authErrorKey(code)));
    } finally {
      setBusy(false);
    }
  }

  const nicknameHint =
    availability === 'checking'
      ? t('auth.register.nicknameChecking')
      : availability === 'available'
        ? t('auth.register.nicknameAvailable')
        : t('auth.register.nicknameHint');
  const nicknameError =
    availability === 'taken' ? t('auth.register.nicknameTaken') : fieldErrors.nickname;

  return (
    <AuthShell brand={t('landing.brand')}>
      <header className="flex flex-col gap-2 text-center">
        <h1 className="font-heading text-2xl font-extrabold">{t('auth.register.title')}</h1>
        <p className="text-[var(--puls-ink-muted)]">{t('auth.register.subtitle')}</p>
      </header>

      <Card>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Field
            id="nickname"
            type="text"
            name="nickname"
            autoComplete="username"
            label={t('auth.register.nickname')}
            hint={nicknameHint}
            value={values.nickname}
            error={nicknameError}
            onChange={(event) => setValues({ ...values, nickname: event.target.value })}
          />
          <div className="flex flex-col gap-1.5">
            <Field
              id="password"
              type="password"
              name="password"
              autoComplete="new-password"
              label={t('auth.register.password')}
              value={values.password}
              error={fieldErrors.password}
              onChange={(event) => setValues({ ...values, password: event.target.value })}
            />
            {values.password.length > 0 ? (
              <p data-testid="password-strength" className="text-xs text-[var(--puls-ink-muted)]">
                {t(`auth.register.strength.${strength}`)}
              </p>
            ) : null}
          </div>
          <Field
            id="passwordConfirm"
            type="password"
            name="passwordConfirm"
            autoComplete="new-password"
            label={t('auth.register.passwordConfirm')}
            value={values.passwordConfirm}
            error={fieldErrors.passwordConfirm}
            onChange={(event) => setValues({ ...values, passwordConfirm: event.target.value })}
          />
          <Field
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            label={t('auth.register.email')}
            hint={t('auth.register.emailHint')}
            value={values.email}
            error={fieldErrors.email}
            onChange={(event) => setValues({ ...values, email: event.target.value })}
          />

          {error ? <Alert>{error}</Alert> : null}

          <PrimaryButton type="submit" disabled={busy}>
            {busy ? t('common.loading') : t('auth.register.submit')}
          </PrimaryButton>
        </form>

        <div className="mt-5">
          <ProviderButtons />
        </div>
      </Card>

      <p className="text-center text-sm text-[var(--puls-ink-muted)]">
        {t('auth.register.haveAccount')}{' '}
        <Link href="/login" className="font-semibold text-[var(--puls-primary-text)]">
          {t('auth.register.goLogin')}
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
