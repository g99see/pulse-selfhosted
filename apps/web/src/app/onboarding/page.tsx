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
import { AuthShell } from '@/components/auth-shell';
import { type IconName } from '@/components/icons';
import { useT } from '@/components/locale-provider';
import { Alert, Card, Field, GhostButton, IconBubble, PrimaryButton, ProgressBar, Select } from '@/components/ui';
import { AuthApiError, authApi } from '@/lib/auth-client';
import { authErrorKey } from '@/lib/i18n';
import { LOCALE_NAMES } from '@/lib/locale';

const TOTAL_STEPS = 4;
const GOALS: GoalKind[] = ['money', 'health', 'habits'];
const VISIBILITIES: ProfileVisibility[] = ['private', 'subscribers', 'public'];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const LOCALES: Locale[] = ['ru', 'en'];
const STEP_ICONS: IconName[] = ['wallet', 'sparkle', 'target', 'home'];
const STEP_TONES: Array<'finance' | 'primary' | 'wellbeing' | 'warning'> = [
  'finance',
  'primary',
  'wellbeing',
  'finance',
];

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
  const { t, locale, setLocale } = useT();
  const router = useRouter();
  const [step, setStep] = useState(1);

  const [currency, setCurrency] = useState('RUB');
  const [timezone, setTimezone] = useState('UTC');
  const [goals, setGoals] = useState<GoalKind[]>(['money']);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [quietHoursStart, setQuietHoursStart] = useState(22);
  const [quietHoursEnd, setQuietHoursEnd] = useState(8);
  const [profileVisibility, setProfileVisibility] = useState<ProfileVisibility>('private');
  const [accountName, setAccountName] = useState(() => t('auth.onboarding.accountNameDefault'));
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

  const stepTitle = t(`auth.onboarding.step${step}`);

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
    <AuthShell brand={t('landing.brand')} align="top">
      <header className="flex flex-col gap-3">
        <h1 className="font-heading text-2xl font-extrabold">{t('auth.onboarding.title')}</h1>
        <ProgressBar
          value={step}
          max={TOTAL_STEPS}
          label={t('auth.onboarding.progress', { current: step, total: TOTAL_STEPS })}
        />
      </header>

      <Card>
        <div className="mb-5 flex items-center gap-3">
          <IconBubble name={STEP_ICONS[step - 1]} tone={STEP_TONES[step - 1]} size={44} />
          <h2 className="font-heading text-xl font-bold" data-testid={`onboarding-step-${step}`}>
            {stepTitle}
          </h2>
        </div>

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <Select
              id="currency"
              label={t('auth.onboarding.currency')}
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
              label={t('auth.onboarding.timezone')}
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
              label={t('auth.onboarding.locale')}
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
            >
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_NAMES[code]}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t('auth.onboarding.goals')}</legend>
              {GOALS.map((goal) => (
                <label key={goal} className="flex items-center gap-3 text-base">
                  <input
                    type="checkbox"
                    checked={goals.includes(goal)}
                    onChange={() => toggleGoal(goal)}
                    className="h-5 w-5"
                  />
                  {t(`auth.onboarding.goal${goal[0].toUpperCase()}${goal.slice(1)}`)}
                </label>
              ))}
            </fieldset>

            <label className="flex items-center justify-between gap-3 text-base">
              {t('auth.onboarding.notifications')}
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
                label={`${t('auth.onboarding.quietHours')} ${t('auth.onboarding.quietFrom')}`}
                value={String(quietHoursStart)}
                onChange={(event) => setQuietHoursStart(Number(event.target.value))}
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>{`${String(hour).padStart(2, '0')}:00`}</option>
                ))}
              </Select>
              <Select
                id="quietTo"
                label={t('auth.onboarding.quietTo')}
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
              label={t('auth.onboarding.visibility')}
              value={profileVisibility}
              onChange={(event) => setProfileVisibility(event.target.value as ProfileVisibility)}
            >
              {VISIBILITIES.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {t(`auth.onboarding.visibility${visibility[0].toUpperCase()}${visibility.slice(1)}`)}
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
              label={t('auth.onboarding.accountName')}
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
            />
            <Select
              id="accountType"
              label={t('auth.onboarding.accountType')}
              value={accountType}
              onChange={(event) => setAccountType(event.target.value as AccountType)}
            >
              <option value="card">{t('auth.onboarding.accountCard')}</option>
              <option value="cash">{t('auth.onboarding.accountCash')}</option>
              <option value="savings">{t('auth.onboarding.accountSavings')}</option>
            </Select>
            <Field
              id="balance"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              label={t('auth.onboarding.balance')}
              value={balance}
              onChange={(event) => setBalance(event.target.value)}
            />
          </div>
        ) : null}

        {error ? (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        ) : null}
      </Card>

      <div className="flex gap-3">
        {step > 1 ? (
          <GhostButton
            type="button"
            onClick={() => setStep((current) => Math.max(1, current - 1))}
            className="flex-1"
          >
            {t('common.back')}
          </GhostButton>
        ) : null}

        {step < TOTAL_STEPS ? (
          <PrimaryButton
            type="button"
            data-testid="onboarding-next"
            onClick={next}
            style={{ flex: 1 }}
          >
            {t('common.next')}
          </PrimaryButton>
        ) : (
          <PrimaryButton
            type="button"
            data-testid="onboarding-finish"
            onClick={finish}
            disabled={busy}
            style={{ flex: 1 }}
          >
            {busy ? t('common.loading') : t('auth.onboarding.finish')}
          </PrimaryButton>
        )}
      </div>
    </AuthShell>
  );
}
