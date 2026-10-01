// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  AccountDto,
  CategoryDto,
  Currency,
  RecurrenceFrequency,
  RecurringPaymentDto,
  RecurringUpcomingItem,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { categoryLabel } from '@/lib/category-label';
import { MASKED_AMOUNT } from '@/components/money';
import { formatDate, formatMoneyLocale } from '@/lib/format';
import { FormToggle } from '@/components/finance-form-toggle';
import { recurringApi } from '@/lib/recurring-client';
import { useQuietMode } from '@/lib/use-quiet-mode';

const FREQUENCIES: { value: RecurrenceFrequency; key: string }[] = [
  { value: 'weekly', key: 'finance.recurring.frequency.weekly' },
  { value: 'monthly', key: 'finance.recurring.frequency.monthly' },
  { value: 'yearly', key: 'finance.recurring.frequency.yearly' },
];

const DAY_LABEL: Record<RecurrenceFrequency, string> = {
  weekly: 'finance.recurring.day.weekly',
  monthly: 'finance.recurring.day.monthly',
  yearly: 'finance.recurring.day.yearly',
};

const inputClass =
  'h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3';

interface RecurringSectionProps {
  accounts: AccountDto[];
  categories: CategoryDto[];
  currency: string;
  onChanged: () => void;
}

/** Секция «Регулярные платежи» на экране финансов (ТЗ §3.2). */
export function RecurringSection({
  accounts,
  categories,
  currency,
  onChanged,
}: RecurringSectionProps) {
  const { t, locale } = useT();
  const quiet = useQuietMode();

  const [payments, setPayments] = useState<RecurringPaymentDto[]>([]);
  const [upcoming, setUpcoming] = useState<RecurringUpcomingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('monthly');
  const [day, setDay] = useState('1');
  const [month, setMonth] = useState('1');

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [list, next] = await Promise.all([recurringApi.list(), recurringApi.upcoming()]);
      setPayments(list.payments);
      setUpcoming(next.upcoming);
      setError(null);
    } catch {
      setError(t('finance.recurring.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const categoryOptions = categories.filter((category) => category.kind === type);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const value = Number(amount.replace(',', '.'));
    if (!name.trim() || !Number.isFinite(value) || value <= 0 || !accountId) return;

    setBusy(true);
    try {
      await recurringApi.create({
        name: name.trim(),
        amount: value,
        type,
        accountId,
        categoryId: categoryId || undefined,
        frequency,
        day: Number(day) || 1,
        month: frequency === 'yearly' ? Number(month) || 1 : undefined,
      });
      setName('');
      setAmount('');
      await reload();
      onChanged();
    } catch {
      setError(t('finance.recurring.error'));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(payment: RecurringPaymentDto): Promise<void> {
    setBusy(true);
    try {
      await recurringApi.setActive(payment.id, !payment.active);
      await reload();
    } catch {
      setError(t('finance.recurring.error'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(payment: RecurringPaymentDto): Promise<void> {
    setBusy(true);
    try {
      await recurringApi.remove(payment.id);
      await reload();
      onChanged();
    } catch {
      setError(t('finance.recurring.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="flex flex-col gap-4 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm sm:p-6"
      data-testid="recurring-section"
    >
      <h2 className="font-heading text-lg font-bold">{t('finance.recurring.title')}</h2>
      <p className="text-xs text-[var(--puls-ink-muted)]">{t('finance.recurring.hint')}</p>

      {error ? (
        <p role="alert" className="text-sm text-[var(--puls-warning-text)]">
          {error}
        </p>
      ) : null}

      <ul
        className={`flex flex-col divide-y divide-[var(--puls-ink-muted)]/15 ${loading ? 'min-h-11' : ''}`}
        data-testid="recurring-list"
      >
        {payments.map((payment) => (
          <li
            key={payment.id}
            className="flex items-center justify-between gap-3 py-3"
            data-testid="recurring-item"
          >
            <span className="flex flex-col">
              <span className="font-medium" data-testid="recurring-name">
                {payment.name}
              </span>
              <span className="text-xs text-[var(--puls-ink-muted)]">
                {t(`finance.recurring.frequency.${payment.frequency}`)}
                {payment.active ? '' : ` · ${t('finance.recurring.paused')}`}
                {' · '}
                {t('finance.recurring.next', {
                  date: formatDate(payment.nextRunAt, locale, {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  }),
                })}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span
                className="font-semibold [font-variant-numeric:tabular-nums]"
                data-testid="recurring-amount"
              >
                {quiet
                  ? MASKED_AMOUNT
                  : formatMoneyLocale(payment.amount, locale, payment.currency as Currency)}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void toggle(payment)}
                data-testid="recurring-toggle"
                className="text-xs text-[var(--puls-ink-muted)] disabled:opacity-50"
              >
                {payment.active ? t('finance.recurring.pause') : t('finance.recurring.resume')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(payment)}
                aria-label={t('finance.recurring.remove')}
                data-testid="recurring-remove"
                className="text-xs text-[var(--puls-ink-muted)] disabled:opacity-50"
              >
                ✕
              </button>
            </span>
          </li>
        ))}
        {payments.length === 0 && !loading ? (
          <li className="py-3 text-sm text-[var(--puls-ink-muted)]" data-testid="recurring-empty">
            {t('finance.recurring.empty')}
          </li>
        ) : null}
      </ul>

      <FormToggle label={t('finance.recurring.new')} testId="recurring-form-toggle">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void submit(event)}>
          <label htmlFor="recurring-name" className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {t('finance.recurring.name')}
            </span>
            <input
              id="recurring-name"
              data-testid="recurring-name-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </label>
          <label htmlFor="recurring-amount" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {t('finance.recurring.amount')}
            </span>
            <input
              id="recurring-amount"
              data-testid="recurring-amount-input"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={`${inputClass} w-32`}
            />
          </label>
          <label htmlFor="recurring-type" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.filter.type')}</span>
            <select
              id="recurring-type"
              value={type}
              onChange={(event) => {
                setType(event.target.value as 'expense' | 'income');
                setCategoryId('');
              }}
              className={inputClass}
            >
              <option value="expense">{t('finance.type.expense')}</option>
              <option value="income">{t('finance.type.income')}</option>
            </select>
          </label>
          <label htmlFor="recurring-account" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {t('finance.recurring.account')}
            </span>
            <select
              id="recurring-account"
              data-testid="recurring-account"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className={inputClass}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="recurring-category" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {t('finance.recurring.category')}
            </span>
            <select
              id="recurring-category"
              data-testid="recurring-category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className={inputClass}
            >
              <option value="">{t('finance.noCategory')}</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {categoryLabel(category, t)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="recurring-frequency" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {t('finance.recurring.frequency')}
            </span>
            <select
              id="recurring-frequency"
              data-testid="recurring-frequency"
              value={frequency}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'weekly' || value === 'monthly' || value === 'yearly')
                  setFrequency(value);
              }}
              className={inputClass}
            >
              {FREQUENCIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.key)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="recurring-day" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t(DAY_LABEL[frequency])}</span>
            <input
              id="recurring-day"
              data-testid="recurring-day"
              inputMode="numeric"
              value={day}
              onChange={(event) => setDay(event.target.value)}
              className={`${inputClass} w-20`}
            />
          </label>
          {frequency === 'yearly' ? (
            <label htmlFor="recurring-month" className="flex flex-col gap-1">
              <span className="text-xs text-[var(--puls-ink-muted)]">
                {t('finance.recurring.month')}
              </span>
              <input
                id="recurring-month"
                data-testid="recurring-month"
                inputMode="numeric"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className={`${inputClass} w-20`}
              />
            </label>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            data-testid="recurring-submit"
            className="h-10 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] shadow-[0_8px_18px_-10px_var(--puls-primary)] disabled:opacity-50"
          >
            {t('finance.recurring.add')}
          </button>
        </form>
      </FormToggle>

      <h3 className="text-sm font-semibold">{t('finance.recurring.upcoming')}</h3>
      <ul
        className={`flex flex-col gap-1 text-sm ${loading ? 'min-h-5' : ''}`}
        data-testid="recurring-upcoming"
      >
        {upcoming.map((item) => (
          <li
            key={`${item.paymentId}-${item.date}`}
            className="flex items-center justify-between gap-3"
          >
            <span>
              <span className="font-medium">{item.name}</span>
              <span className="text-xs text-[var(--puls-ink-muted)]">
                {' · '}
                {formatDate(item.date, locale, { day: '2-digit', month: 'short' })}
              </span>
            </span>
            <span className="[font-variant-numeric:tabular-nums]">{item.amountLabel}</span>
          </li>
        ))}
        {upcoming.length === 0 && !loading ? (
          <li className="text-[var(--puls-ink-muted)]" data-testid="recurring-upcoming-empty">
            {t('finance.recurring.upcoming.empty')}
          </li>
        ) : null}
      </ul>

      {currency ? <span className="sr-only">{currency}</span> : null}
    </section>
  );
}
