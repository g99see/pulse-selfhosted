// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ExchangeRateDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Icon } from '@/components/icons';
import { Alert, Card, EmptyState, Field, IconBubble, PrimaryButton, Select } from '@/components/ui';
import { CURRENCY_OPTIONS, parseRateValue, validateRateForm } from '@/lib/currency-form';
import { formatDate, formatNumber } from '@/lib/format';
import { financeApi } from '@/lib/finance-client';

/** Сегодняшняя дата в формате YYYY-MM-DD (значение по умолчанию для курса). */
function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Экран «Курсы валют» (ТЗ §3.2): ручной CRUD курсов для пересчёта в основную валюту. */
export default function RatesPage() {
  const { t, locale } = useT();

  const [rates, setRates] = useState<ExchangeRateDto[]>([]);
  const [date, setDate] = useState(todayKey());
  const [base, setBase] = useState('USD');
  const [quote, setQuote] = useState('RUB');
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const response = await financeApi.rates();
      setRates(response.rates);
      setError(null);
    } catch {
      setError(t('auth.error.generic'));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaved(false);
    const validation = validateRateForm({ date, base, quote, rate });
    if (!validation.ok) {
      setError(t(validation.errorKey ?? 'auth.error.generic'));
      return;
    }

    setBusy(true);
    try {
      await financeApi.upsertRate({ date, base, quote, rate: validation.rate! });
      setRate('');
      setSaved(true);
      setError(null);
      await reload();
    } catch {
      setError(t('auth.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    await financeApi.removeRate(id);
    await reload();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconBubble name="chart" tone="finance" size={48} />
          <h1 className="font-heading text-3xl font-extrabold">{t('finance.rates.title')}</h1>
        </div>
        <Link
          href="/finance"
          className="inline-flex h-10 items-center rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-4 text-sm font-semibold text-[var(--puls-primary-text)]"
        >
          {t('finance.title')}
        </Link>
      </div>

      <p className="text-sm text-[var(--puls-ink-muted)]">{t('finance.rates.hint')}</p>

      {error ? <Alert>{error}</Alert> : null}
      {saved ? (
        <div data-testid="rate-saved">
          <Alert tone="success">{t('finance.rates.saved')}</Alert>
        </div>
      ) : null}

      <Card>
        <ul
          className="flex flex-col divide-y divide-[var(--puls-line)]"
          data-testid="finance-rates"
        >
          {rates.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-3">
              <span className="flex flex-col">
                <span className="font-medium" data-testid="rate-pair">
                  {item.base} → {item.quote}
                </span>
                <span className="text-xs text-[var(--puls-ink-muted)]">
                  {formatDate(item.date, locale, {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}{' '}
                  · {t(`finance.rates.source.${item.source}`)}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span
                  className="font-semibold [font-variant-numeric:tabular-nums]"
                  data-testid="rate-value"
                >
                  {formatNumber(item.rate, locale, { maximumFractionDigits: 8 })}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(item.id)}
                  aria-label={t('finance.rates.delete')}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--puls-ink-muted)] hover:bg-[var(--puls-surface-2)]"
                >
                  <Icon name="close" size={14} />
                </button>
              </span>
            </li>
          ))}
          {rates.length === 0 ? (
            <li data-testid="rates-empty">
              <EmptyState tone="finance" icon="chart" title={t('finance.rates.empty')} />
            </li>
          ) : null}
        </ul>
      </Card>

      <Card>
        <form
          className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end"
          onSubmit={(event) => void submit(event)}
        >
          <Field
            id="rate-date"
            type="date"
            label={t('finance.rates.date')}
            data-testid="rate-date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <Select
            id="rate-base"
            label={t('finance.rates.base')}
            data-testid="rate-base"
            value={base}
            onChange={(event) => setBase(event.target.value)}
          >
            {CURRENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value}
              </option>
            ))}
          </Select>
          <Select
            id="rate-quote"
            label={t('finance.rates.quote')}
            data-testid="rate-quote"
            value={quote}
            onChange={(event) => setQuote(event.target.value)}
          >
            {CURRENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value}
              </option>
            ))}
          </Select>
          <Field
            id="rate-value"
            label={t('finance.rates.rate')}
            data-testid="rate-input"
            inputMode="decimal"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
          <PrimaryButton
            type="submit"
            data-testid="rate-submit"
            disabled={busy || parseRateValue(rate) === null}
          >
            {t('finance.rates.add')}
          </PrimaryButton>
        </form>
      </Card>
    </div>
  );
}
