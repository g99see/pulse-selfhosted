// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type {
  AccountDto,
  Currency,
  ReconciliationItem,
  ReconciliationResponse,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, Card, EmptyState, Field, IconBubble, PrimaryButton, Select } from '@/components/ui';
import { financeApi } from '@/lib/finance-client';
import { formatDate, formatMoneyLocale } from '@/lib/format';

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Экран «Сверка»: баланс Пульса против баланса банка и список расхождений. */
export default function ReconcilePage() {
  const { t, locale } = useT();
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [accountId, setAccountId] = useState('');
  const [report, setReport] = useState<ReconciliationResponse | null>(null);
  const [manualBalance, setManualBalance] = useState('');
  const [manualDate, setManualDate] = useState(todayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void financeApi.accounts().then((response) => {
      setAccounts(response.accounts);
      setAccountId((current) => current || response.accounts[0]?.id || '');
    });
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setError(null);
    try {
      setReport(await financeApi.reconciliation(id));
    } catch {
      setError('finance.reconcile.error.load');
    }
  }, []);

  useEffect(() => {
    void load(accountId);
  }, [accountId, load]);

  async function saveManual(): Promise<void> {
    const value = Number(manualBalance.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(value) || manualBalance.trim() === '') {
      setError('finance.reconcile.error.balance');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setReport(await financeApi.setBankBalance(accountId, { balance: value, date: manualDate }));
      setManualBalance('');
    } catch {
      setError('finance.reconcile.error.save');
    } finally {
      setBusy(false);
    }
  }

  const money = (value: number): string =>
    formatMoneyLocale(value, locale, (report?.currency ?? 'RUB') as Currency);

  function describe(item: ReconciliationItem): string {
    const when = `${formatDate(item.date, locale)}${item.time ? ` ${item.time}` : ''}`;
    return `${when} · ${money(item.amount)}${item.description ? ` · ${item.description}` : ''}`;
  }

  const differenceZero = report?.difference === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconBubble name="inbox" tone="finance" size={48} />
          <h1 className="font-heading text-2xl font-extrabold">{t('finance.reconcile.title')}</h1>
        </div>
        <Link
          href="/finance"
          className="inline-flex h-11 items-center rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-4 text-sm font-semibold text-[var(--puls-primary-text)]"
        >
          {t('common.back')}
        </Link>
      </div>
      <p className="text-sm text-[var(--puls-ink-muted)]">{t('finance.reconcile.subtitle')}</p>

      {error ? <Alert>{t(error)}</Alert> : null}

      <Card className="flex flex-col gap-3">
        <Select
          id="reconcile-account"
          data-testid="reconcile-account"
          label={t('finance.reconcile.account')}
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </Card>

      {report ? (
        <Card className="flex flex-col gap-3" data-testid="reconcile-summary">
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--puls-ink-muted)]">{t('finance.reconcile.pulse')}</dt>
              <dd
                className="text-lg font-bold [font-variant-numeric:tabular-nums]"
                data-testid="reconcile-pulse"
              >
                {money(report.pulseBalanceAsOf ?? report.pulseBalance)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--puls-ink-muted)]">
                {report.bankSource === 'manual'
                  ? t('finance.reconcile.bank.manual')
                  : t('finance.reconcile.bank.statement')}
                {report.bankAsOf ? ` · ${formatDate(report.bankAsOf, locale)}` : ''}
              </dt>
              <dd
                className="text-lg font-bold [font-variant-numeric:tabular-nums]"
                data-testid="reconcile-bank"
              >
                {report.bankBalance === null ? '—' : money(report.bankBalance)}
              </dd>
            </div>
          </dl>
          {report.difference === null ? (
            <p className="text-sm text-[var(--puls-ink-muted)]">{t('finance.reconcile.noBank')}</p>
          ) : (
            <p
              data-testid="reconcile-difference"
              className={`rounded-[var(--radius-button)] px-4 py-3 text-sm font-semibold ${
                differenceZero
                  ? 'bg-[var(--puls-finance-soft)] text-[var(--puls-finance-text)]'
                  : 'bg-[var(--puls-surface-2)]'
              }`}
            >
              {differenceZero
                ? t('finance.reconcile.match')
                : t('finance.reconcile.difference', { amount: money(report.difference) })}
            </p>
          )}
          {report.difference !== null && report.difference !== 0 && report.unexplained !== 0 ? (
            <p className="text-xs text-[var(--puls-ink-muted)]" data-testid="reconcile-unexplained">
              {t('finance.reconcile.unexplained', { amount: money(report.unexplained ?? 0) })}
            </p>
          ) : null}
          {report.afterBank.count > 0 ? (
            <p className="text-xs text-[var(--puls-ink-muted)]">
              {t('finance.reconcile.after', {
                count: report.afterBank.count,
                amount: money(report.afterBank.net),
              })}
            </p>
          ) : null}
        </Card>
      ) : null}

      {report && report.bankBalance !== null && report.bankSource === 'statement' ? (
        <Card className="flex flex-col gap-2">
          <h2 className="font-heading text-lg font-bold">{t('finance.reconcile.items')}</h2>
          {report.items.length === 0 ? (
            <EmptyState title={t('finance.reconcile.itemsEmpty')} />
          ) : (
            <ul className="flex flex-col gap-2 text-sm" data-testid="reconcile-items">
              {report.items.map((item, index) => (
                <li
                  key={`${item.kind}-${item.transactionId ?? item.externalId ?? index}`}
                  className="border-t border-[var(--puls-line)] pt-2"
                >
                  <div className="font-semibold">
                    {t(`finance.reconcile.kind.${item.kind}`)}
                    {item.kind === 'extra_in_pulse' && item.manual
                      ? ` (${t('finance.reconcile.manual')})`
                      : ''}
                  </div>
                  <div className="text-[var(--puls-ink-muted)]">{describe(item)}</div>
                  {item.kind === 'chain_break' &&
                  item.expectedBalance !== null &&
                  item.actualBalance !== null ? (
                    <div className="text-xs text-[var(--puls-ink-muted)]">
                      {t('finance.reconcile.chain', {
                        expected: money(item.expectedBalance),
                        actual: money(item.actualBalance),
                      })}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">{t('finance.reconcile.manual.title')}</h2>
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('finance.reconcile.manual.hint')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            id="reconcile-balance"
            data-testid="reconcile-manual-balance"
            label={t('finance.reconcile.manual.balance')}
            inputMode="decimal"
            value={manualBalance}
            onChange={(event) => setManualBalance(event.target.value)}
          />
          <Field
            id="reconcile-date"
            data-testid="reconcile-manual-date"
            type="date"
            label={t('finance.reconcile.manual.date')}
            value={manualDate}
            onChange={(event) => setManualDate(event.target.value)}
          />
        </div>
        <PrimaryButton
          type="button"
          data-testid="reconcile-manual-save"
          disabled={busy || !accountId}
          onClick={() => void saveManual()}
        >
          {t('finance.reconcile.manual.save')}
        </PrimaryButton>
      </Card>
    </div>
  );
}
