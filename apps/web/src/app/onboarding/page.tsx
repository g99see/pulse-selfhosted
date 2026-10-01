// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  OnboardingSchema,
  SUPPORTED_CURRENCIES,
  type AccountType,
  type GoalKind,
  type Locale,
  type OnboardingInputValues,
  type ProfileVisibility,
} from '@puls/shared';
import { Alert, Card, Field, PrimaryButton, ProgressBar, Select } from '@/components/ui';
import { AuthApiError, authApi } from '@/lib/auth-client';
import { authErrorKey, t } from '@/lib/i18n';

const TOTAL_STEPS = 4;
const GOALS: GoalKind[] = ['money', 'health', 'habits'];
const ACCOUNT_TYPES: AccountType[] = ['card', 'cash', 'savings'];
const VISIBILITIES: ProfileVisibility[] = ['private', 'subscribers', 'public'];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** Курированный список зон + текущая — без расхождений гидрации. */
const TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Warsaw',
  'Europe/Kyiv',
  'Europe/Moscow',
  'Asia/Almaty',
  'Asia/Tbilisi',
  'Asia/Yerevan',
  'Asia/Tashkent',
  'Asia/Dubai',
  'Asia/Novosibirsk',
  'Asia/Vladivostok',
  'America/New_York',
  'America/Los_Angeles',
  'America/Sao_Paulo',
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);

  const [currency, setCurrency] = useState('RUB');
  const [timezone, setTimezone] = useState('UTC');
  const [locale, setLocale] = useState<Locale>('ru');
  const [goals, setGoals] = useState<GoalKind[]>(['money']);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [quietHoursStart, setQuietHoursStart] = useState(22);
  const [quietHoursEnd, setQuietHoursEnd] = useState(8);
  const [profileVisibility, setProfileVisibility] = useState<ProfileVisibility>('private');
  const [accountName, setAccountName] = useState('Основной счёт');
  const [accountType, setAccountType] = useState<AccountType>('card');
  const [balance, setBalance] = useState('0');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Проверяем вход и определяем часовой пояс пользователя.
  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected) setTimezone(detected);

    authApi
      .me()
      .then((me) => {
        if (me.onboardingCompleted) router.replace('/app');
      })
      .catch((thrown: unknown) => {
        if (thrown instanceof AuthApiError && thrown.status === 401) router.replace('/login');
      });
  }, [router]);

  const stepTitle = t(`auth.onboarding.step${step}`, locale);

  function toggleGoal(goal: GoalKind): void {
    setGoals((previous) =>
      previous.includes(goal) ? previous.filter((item) => item !== goal) : [...previous, goal],
    );
  }

  function next(): void {
    setError(null);
    if (step === 3 && goals.length === 0) {
      setError(t('auth.onboarding.goalsHint'));
      return;
    }
    setStep((current) => Math.min(TOTAL_STEPS, current + 1));
  }

  async function finish(): Promise<void> {
    setError(null);

    const payload: OnboardingInputValues = {
      timezone,
      currency: currency as OnboardingInputValues['currency'],
      locale,
      goals,
      notificationsEnabled,
      quietHoursStart,
      quietHoursEnd,
      profileVisibility,
      ...(accountName.trim().length > 0
        ? {
            firstAccount: {
              name: accountName.trim(),
              type: accountType,
              balance: Number(balance.replace(',', '.')) || 0,
            },
          }
        : {}),
    };

    const parsed = OnboardingSchema.safeParse(payload);
    if (!parsed.success) {
      setError(t('auth.error.validation_error'));
      return;
    }

    setBusy(true);
    try {
      await authApi.completeOnboarding(parsed.data);
      router.push('/app');
    } catch (thrown) {
      setError(t(authErrorKey(thrown instanceof AuthApiError ? thrown.code : 'unknown_error')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-5 py-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-extrabold">{t('auth.onboarding.title')}</h1>
        <ProgressBar
          value={step}
          max={TOTAL_STEPS}
          label={t('auth.onboarding.progress', locale, { current: step, total: TOTAL_STEPS })}
        />
      </header>

      <Card>
        <h2 className="mb-4 text-xl font-bold" data-testid={`onboarding-step-${step}`}>
          {stepTitle}
        </h2>

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <Select
              id="currency"
              label={t('auth.onboarding.currency', locale)}
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {SUPPORTED_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
            <Select
              id="timezone"
              label={t('auth.onboarding.timezone', locale)}
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              {[timezone, ...TIMEZONES.filter((zone) => zone !== timezone)].map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-3">
            <Select
              id="locale"
              label={t('auth.onboarding.locale', locale)}
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
            >
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </Select>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t('auth.onboarding.goals', locale)}</legend>
              {GOALS.map((goal) => (
                <label key={goal} className="flex items-center gap-3 text-base">
                  <input
                    type="checkbox"
                    checked={goals.includes(goal)}
                    onChange={() => toggleGoal(goal)}
                    className="h-5 w-5"
                  />
                  {t(`auth.onboarding.goal${goal[0].toUpperCase()}${goal.slice(1)}`, locale)}
                </label>
              ))}
            </fieldset>

            <label className="flex items-center justify-between gap-3 text-base">
              {t('auth.onboarding.notifications', locale)}
              <input
                type="checkbox"
                checked={notificationsEnabled}
                onChange={(event) => setNotificationsEnabled(event.target.checked)}
                className="h-5 w-5"
              />
            </label>

            <div className="flex items-end gap-2">
              <Select
                id="quietFrom"
                label={`${t('auth.onboarding.quietHours', locale)} ${t('auth.onboarding.quietFrom', locale)}`}
                value={String(quietHoursStart)}
                onChange={(event) => setQuietHoursStart(Number(event.target.value))}
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>{`${String(hour).padStart(2, '0')}:00`}</option>
                ))}
              </Select>
              <Select
                id="quietTo"
                label={t('auth.onboarding.quietTo', locale)}
                value={String(quietHoursEnd)}
                onChange={(event) => setQuietHoursEnd(Number(event.target.value))}
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>{`${String(hour).padStart(2, '0')}:00`}</option>
                ))}
              </Select>
            </div>

            <Select
              id="visibility"
              label={t('auth.onboarding.visibility', locale)}
              value={profileVisibility}
              onChange={(event) => setProfileVisibility(event.target.value as ProfileVisibility)}
            >
              {VISIBILITIES.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {t(
                    `auth.onboarding.visibility${visibility[0].toUpperCase()}${visibility.slice(1)}`,
                    locale,
                  )}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="flex flex-col gap-4">
            <Field
              id="accountName"
              type="text"
              label={t('auth.onboarding.accountName', locale)}
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
            />
            <Select
              id="accountType"
              label={t('auth.onboarding.accountType', locale)}
              value={accountType}
              onChange={(event) => setAccountType(event.target.value as AccountType)}
            >
              <option value="card">{t('auth.onboarding.accountCard', locale)}</option>
              <option value="cash">{t('auth.onboarding.accountCash', locale)}</option>
              <option value="savings">{t('auth.onboarding.accountSavings', locale)}</option>
            </Select>
            <Field
              id="balance"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              label={t('auth.onboarding.balance', locale)}
              value={balance}
              onChange={(event) => setBalance(event.target.value)}
            />
          </div>
        ) : null}

        {error ? <div className="mt-4">{<Alert>{error}</Alert>}</div> : null}
      </Card>

      <div className="flex gap-3">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep((current) => Math.max(1, current - 1))}
            className="h-12 flex-1 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 font-semibold"
          >
            {t('common.back', locale)}
          </button>
        ) : null}

        {step < TOTAL_STEPS ? (
          <PrimaryButton type="button" data-testid="onboarding-next" onClick={next} style={{ flex: 1 }}>
            {t('common.next', locale)}
          </PrimaryButton>
        ) : (
          <PrimaryButton
            type="button"
            data-testid="onboarding-finish"
            onClick={finish}
            disabled={busy}
            style={{ flex: 1 }}
          >
            {busy ? t('common.loading', locale) : t('auth.onboarding.finish', locale)}
          </PrimaryButton>
        )}
      </div>
    </main>
  );
}
