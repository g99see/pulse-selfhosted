// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ExchangeRateDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
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
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-extrabold">{t('finance.rates.title')}</h1>
        <Link href="/finance" className="text-sm text-[var(--puls-primary)]">
          {t('finance.title')}
        </Link>
      </div>

      <p className="text-sm text-[var(--puls-ink-muted)]">{t('finance.rates.hint')}</p>

      {error ? (
        <p role="alert" className="text-sm text-[var(--puls-warning)]">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-[var(--puls-finance)]" data-testid="rate-saved">
          {t('finance.rates.saved')}
        </p>
      ) : null}

      <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
        <ul className="flex flex-col divide-y divide-[var(--puls-ink-muted)]/15" data-testid="finance-rates">
          {rates.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2">
              <span className="flex flex-col">
                <span className="font-medium" data-testid="rate-pair">
                  {item.base} → {item.quote}
                </span>
                <span className="text-xs text-[var(--puls-ink-muted)]">
                  {formatDate(item.date, locale, { day: '2-digit', month: 'short', year: 'numeric' })} ·{' '}
                  {t(`finance.rates.source.${item.source}`)}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="font-semibold [font-variant-numeric:tabular-nums]" data-testid="rate-value">
                  {formatNumber(item.rate, locale, { maximumFractionDigits: 8 })}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(item.id)}
                  aria-label={t('finance.rates.delete')}
                  className="text-xs text-[var(--puls-ink-muted)]"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
          {rates.length === 0 ? (
            <li className="py-3 text-sm text-[var(--puls-ink-muted)]" data-testid="rates-empty">
              {t('finance.rates.empty')}
            </li>
          ) : null}
        </ul>
      </section>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => void submit(event)}
      >
        <label htmlFor="rate-date" className="flex flex-col gap-1">
          <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.rates.date')}</span>
          <input
            id="rate-date"
            type="date"
            data-testid="rate-date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-3"
          />
        </label>
        <label htmlFor="rate-base" className="flex flex-col gap-1">
          <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.rates.base')}</span>
          <select
            id="rate-base"
            data-testid="rate-base"
            value={base}
            onChange={(event) => setBase(event.target.value)}
            className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-3"
          >
            {CURRENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="rate-quote" className="flex flex-col gap-1">
          <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.rates.quote')}</span>
          <select
            id="rate-quote"
            data-testid="rate-quote"
            value={quote}
            onChange={(event) => setQuote(event.target.value)}
            className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-3"
          >
            {CURRENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="rate-value" className="flex flex-col gap-1">
          <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.rates.rate')}</span>
          <input
            id="rate-value"
            data-testid="rate-input"
            inputMode="decimal"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            className="h-10 w-32 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-3"
          />
        </label>
        <button
          type="submit"
          data-testid="rate-submit"
          disabled={busy || parseRateValue(rate) === null}
          className="h-10 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
        >
          {t('finance.rates.add')}
        </button>
      </form>
    </div>
  );
}
