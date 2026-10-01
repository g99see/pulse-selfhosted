// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { SetupSchema, type RegistrationMode } from '@puls/shared';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Card, Field, PrimaryButton } from '@/components/ui';
import { useT } from '@/components/locale-provider';
import { AuthApiError } from '@/lib/auth-client';
import { setupApi } from '@/lib/setup-client';

type Phase = 'checking' | 'form' | 'done' | 'already';

/**
 * Мастер первого запуска (ТЗ §9 п.7, §10): создаёт первого администратора,
 * пока в БД нет ни одного пользователя. Повторный заход возможен только на
 * пустом инстансе — после создания администратора форма закрыта.
 */
export default function SetupPage() {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>('checking');
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>('open');
  const [values, setValues] = useState({ email: '', password: '', nickname: '' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    setupApi
      .status()
      .then((status) => {
        if (!active) return;
        setRegistrationMode(status.registrationMode);
        setPhase(status.needsSetup ? 'form' : 'already');
      })
      .catch(() => {
        if (active) setPhase('already');
      });

    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const parsed = SetupSchema.safeParse(values);
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
      await setupApi.create(parsed.data);
      setPhase('done');
    } catch (thrown) {
      // Гонка двух мастеров: второй получает setup_completed — показываем, что уже готово.
      if (thrown instanceof AuthApiError && thrown.code === 'setup_completed') {
        setPhase('already');
      } else {
        setError(t('setup.error'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'checking') {
    return (
      <AuthShell brand={t('landing.brand')}>
        <p className="text-center text-[var(--puls-ink-muted)]" data-testid="setup-checking">
          {t('setup.checking')}
        </p>
      </AuthShell>
    );
  }

  if (phase === 'already') {
    return (
      <AuthShell brand={t('landing.brand')}>
        <header className="flex flex-col gap-2 text-center">
          <p className="mx-auto w-fit rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-3 py-1 text-xs font-semibold tracking-wide text-[var(--puls-primary-text)] uppercase">
            {t('setup.badge')}
          </p>
          <h1 className="font-heading text-3xl font-extrabold" data-testid="setup-already">
            {t('setup.already.title')}
          </h1>
        </header>
        <Card>
          <p className="text-[var(--puls-ink-muted)]">{t('setup.already.body')}</p>
          <p className="mt-3 text-sm text-[var(--puls-ink-muted)]">
            {t(`setup.mode.${registrationMode}`)}
          </p>
        </Card>
        <Link
          href="/login"
          className="text-center text-sm font-semibold text-[var(--puls-primary-text)]"
        >
          {t('setup.already.login')}
        </Link>
      </AuthShell>
    );
  }

  if (phase === 'done') {
    return (
      <AuthShell brand={t('landing.brand')}>
        <header className="flex flex-col gap-2 text-center">
          <h1 className="font-heading text-3xl font-extrabold" data-testid="setup-done">
            {t('setup.done.title')}
          </h1>
        </header>
        <Alert tone="success">{t('setup.done.body')}</Alert>
        <Link
          href="/login"
          className="rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 py-3 text-center font-semibold text-[var(--puls-on-primary)] transition-opacity hover:opacity-90"
        >
          {t('setup.done.login')}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell brand={t('landing.brand')}>
      <header className="flex flex-col gap-2 text-center">
        <p className="mx-auto w-fit rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-3 py-1 text-xs font-semibold tracking-wide text-[var(--puls-primary-text)] uppercase">
          {t('setup.badge')}
        </p>
        <h1 className="font-heading text-3xl font-extrabold">{t('setup.title')}</h1>
        <p className="text-[var(--puls-ink-muted)]">{t('setup.subtitle')}</p>
      </header>

      <Card>
        <form
          className="flex flex-col gap-4"
          onSubmit={onSubmit}
          noValidate
          data-testid="setup-form"
        >
          <Field
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            label={t('setup.email')}
            value={values.email}
            error={fieldErrors.email}
            onChange={(event) => setValues({ ...values, email: event.target.value })}
          />
          <Field
            id="password"
            type="password"
            name="password"
            autoComplete="new-password"
            label={t('setup.password')}
            hint={t('setup.passwordHint')}
            value={values.password}
            error={fieldErrors.password}
            onChange={(event) => setValues({ ...values, password: event.target.value })}
          />
          <Field
            id="nickname"
            type="text"
            name="nickname"
            autoComplete="username"
            label={t('setup.nickname')}
            hint={t('setup.nicknameHint')}
            value={values.nickname}
            error={fieldErrors.nickname}
            onChange={(event) => setValues({ ...values, nickname: event.target.value })}
          />

          {error ? <Alert>{error}</Alert> : null}

          <PrimaryButton type="submit" disabled={busy} data-testid="setup-submit">
            {busy ? t('common.loading') : t('setup.submit')}
          </PrimaryButton>
        </form>
      </Card>
    </AuthShell>
  );
}
