// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  monthKey,
  type AccountType,
  type BudgetDto,
  type Currency,
  type FinanceOverviewResponse,
  type TransactionDto,
  type TransactionKind,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { MASKED_AMOUNT } from '@/components/money';
import { CategoryManager } from '@/components/category-manager';
import { RecurringSection } from '@/components/recurring-section';
import { CURRENCY_OPTIONS } from '@/lib/currency-form';
import { formatDate, formatMoneyLocale } from '@/lib/format';
import { financeApi, FINANCE_CHANGED_EVENT } from '@/lib/finance-client';
import { useQuietMode } from '@/lib/use-quiet-mode';

type AccountTypeOption = { value: AccountType; key: string };
const ACCOUNT_TYPES: AccountTypeOption[] = [
  { value: 'card', key: 'finance.account.card' },
  { value: 'cash', key: 'finance.account.cash' },
  { value: 'savings', key: 'finance.account.savings' },
];

const LEVEL_COLOR: Record<BudgetDto['level'], string> = {
  ok: 'var(--puls-finance)',
  warning: 'var(--puls-accent)',
  exceeded: 'var(--puls-warning)',
};

/** Цвет текста уровня бюджета: контрастные токены (WCAG AA), заливка полосы — LEVEL_COLOR. */
const LEVEL_TEXT_COLOR: Record<BudgetDto['level'], string> = {
  ok: 'var(--puls-finance-text)',
  warning: 'var(--puls-ink)',
  exceeded: 'var(--puls-warning-text)',
};

/** Экран «Финансы» (ТЗ §8 пункт 5): счета, транзакции с фильтрами, бюджеты. */
export default function FinancePage() {
  const { t, locale } = useT();
  const quiet = useQuietMode();

  const [overview, setOverview] = useState<FinanceOverviewResponse | null>(null);
  const [transactions, setTransactions] = useState<TransactionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterType, setFilterType] = useState<'all' | TransactionKind>('all');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterAccount, setFilterAccount] = useState('');

  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('card');
  const [accountBalance, setAccountBalance] = useState('');
  const [accountCurrency, setAccountCurrency] = useState('');

  const [budgetCategory, setBudgetCategory] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [busy, setBusy] = useState(false);

  const month = useMemo(() => monthKey(new Date()), []);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [summary, list] = await Promise.all([
        financeApi.overview(month),
        financeApi.transactions({
          type: filterType === 'all' ? undefined : filterType,
          categoryId: filterCategory || undefined,
          accountId: filterAccount || undefined,
        }),
      ]);
      setOverview(summary);
      setTransactions(list.transactions);
      setError(null);
    } catch {
      setError(t('auth.error.generic'));
    } finally {
      setLoading(false);
    }
  }, [month, filterType, filterCategory, filterAccount, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    function onChanged(): void {
      void reload();
    }
    window.addEventListener(FINANCE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(FINANCE_CHANGED_EVENT, onChanged);
  }, [reload]);

  const accounts = overview?.accounts ?? [];
  const categories = overview?.categories ?? [];
  const budgets = overview?.budgets ?? [];
  const currency = overview?.currency ?? 'RUB';
  // Режим «Тишина» (ТЗ §4): все суммы на экране прячутся одной маской.
  const money = (value: number, currencyCode: Currency = currency as Currency): string =>
    quiet ? MASKED_AMOUNT : formatMoneyLocale(value, locale, currencyCode);
  const expenseCategories = categories.filter((category) => category.kind === 'expense');
  // Валюта нового счёта: по умолчанию — основная валюта пользователя.
  const selectedAccountCurrency = accountCurrency || currency;

  async function addAccount(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!accountName.trim()) return;
    setBusy(true);
    try {
      await financeApi.createAccount({
        name: accountName.trim(),
        type: accountType,
        balance: Number(accountBalance.replace(',', '.')) || 0,
        currency: selectedAccountCurrency,
      });
      setAccountName('');
      setAccountBalance('');
      setAccountCurrency('');
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function addBudget(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const limit = Number(budgetLimit.replace(',', '.'));
    if (!budgetCategory || !Number.isFinite(limit) || limit <= 0) return;
    setBusy(true);
    try {
      await financeApi.upsertBudget({ categoryId: budgetCategory, month, limit });
      setBudgetLimit('');
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function removeTransaction(id: string): Promise<void> {
    await financeApi.removeTransaction(id);
    await reload();
  }

  function amountClass(type: TransactionKind): string {
    if (type === 'income') return 'text-[var(--puls-finance-text)]';
    if (type === 'transfer') return 'text-[var(--puls-ink-muted)]';
    return 'text-[var(--puls-warning-text)]';
  }

  function amountPrefix(type: TransactionKind): string {
    if (type === 'income') return '+';
    if (type === 'transfer') return '';
    return '−';
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-extrabold">{t('finance.title')}</h1>
          <Link
            href="/finance/import"
            data-testid="import-link"
            className="text-sm text-[var(--puls-primary-text)]"
          >
            {t('finance.import.open')}
          </Link>
        </div>
        {overview ? (
          <p className="text-sm text-[var(--puls-ink-muted)]">
            {t('finance.total')}{' '}
            <span className="font-semibold text-[var(--puls-ink)] [font-variant-numeric:tabular-nums]">
              {money(overview.totalBalance)}
            </span>
          </p>
        ) : (
          // Резервируем строку до загрузки данных, чтобы шапка не сдвигала макет (CLS).
          <p className="text-sm text-[var(--puls-ink-muted)]">
            {t('finance.total')}{' '}
            <span className="font-semibold text-[var(--puls-ink)] [font-variant-numeric:tabular-nums]" />
          </p>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--puls-warning-text)]">
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
        <h2 className="text-lg font-bold">{t('finance.accounts')}</h2>
        <ul className="flex min-h-24 flex-col gap-2" data-testid="finance-accounts">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex items-center justify-between rounded-[var(--radius-button)] border border-[var(--puls-line)] px-4 py-2"
            >
              <span className="flex flex-col">
                <span className="font-medium">{account.name}</span>
                <span className="text-xs text-[var(--puls-ink-muted)]">
                  {t(`finance.account.${account.type}`)}
                </span>
              </span>
              <span className="font-semibold [font-variant-numeric:tabular-nums]">
                {money(account.balance, account.currency as Currency)}
              </span>
            </li>
          ))}
          {accounts.length === 0 && !loading ? (
            <li className="text-sm text-[var(--puls-ink-muted)]">{t('finance.account.add')}</li>
          ) : null}
        </ul>

        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void addAccount(event)}>
          <label htmlFor="account-name" className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.account.name')}</span>
            <input
              id="account-name"
              data-testid="account-name"
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            />
          </label>
          <label htmlFor="account-type" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.account.type')}</span>
            <select
              id="account-type"
              value={accountType}
              onChange={(event) => setAccountType(event.target.value as AccountType)}
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            >
              {ACCOUNT_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.key)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="account-balance" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.account.balance')}</span>
            <input
              id="account-balance"
              inputMode="decimal"
              value={accountBalance}
              onChange={(event) => setAccountBalance(event.target.value)}
              className="h-10 w-28 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            />
          </label>
          <label htmlFor="account-currency" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.account.currency')}</span>
            <select
              id="account-currency"
              data-testid="account-currency"
              value={selectedAccountCurrency}
              onChange={(event) => setAccountCurrency(event.target.value)}
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            >
              {CURRENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="h-10 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
          >
            {t('finance.account.add')}
          </button>
        </form>
      </section>

      <CategoryManager categories={categories} loading={loading} onChanged={() => void reload()} />

      <RecurringSection accounts={accounts} categories={categories} currency={currency} onChanged={() => void reload()} />

      <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">{t('finance.transactions')}</h2>
          <Link href="/finance/rates" className="text-sm text-[var(--puls-primary)]" data-testid="rates-link">
            {t('finance.rates.link')}
          </Link>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.filter.type')}</span>
            <select
              data-testid="filter-type"
              value={filterType}
              onChange={(event) => setFilterType(event.target.value as 'all' | TransactionKind)}
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            >
              <option value="all">{t('finance.filter.all')}</option>
              <option value="expense">{t('finance.type.expense')}</option>
              <option value="income">{t('finance.type.income')}</option>
              <option value="transfer">{t('finance.type.transfer')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.filter.category')}</span>
            <select
              data-testid="filter-category"
              value={filterCategory}
              onChange={(event) => setFilterCategory(event.target.value)}
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            >
              <option value="">{t('finance.filter.all')}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.filter.account')}</span>
            <select
              value={filterAccount}
              onChange={(event) => setFilterAccount(event.target.value)}
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            >
              <option value="">{t('finance.filter.all')}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <ul className="flex min-h-48 flex-col divide-y divide-[var(--puls-ink-muted)]/15" data-testid="finance-transactions">
          {transactions.map((transaction) => (
            <li key={transaction.id} className="flex items-center justify-between gap-3 py-2">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: transaction.categoryColor ?? 'var(--puls-ink-muted)' }}
                />
                <span className="flex flex-col">
                  <span className="font-medium" data-testid="transaction-category">
                    {transaction.categoryName ?? t('finance.noCategory')}
                  </span>
                  <span className="text-xs text-[var(--puls-ink-muted)]">
                    {transaction.comment ? `${transaction.comment} · ` : ''}
                    {transaction.accountName} · {formatDate(transaction.date, locale, { day: '2-digit', month: 'short' })}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="flex flex-col items-end">
                  <span
                    className={`font-semibold [font-variant-numeric:tabular-nums] ${amountClass(transaction.type)}`}
                    data-testid="transaction-amount"
                  >
                    {amountPrefix(transaction.type)}
                    {money(transaction.amount, transaction.currency as Currency)}
                  </span>
                  {transaction.currency !== transaction.baseCurrency ? (
                    <span
                      className="text-xs text-[var(--puls-ink-muted)] [font-variant-numeric:tabular-nums]"
                      data-testid="transaction-base"
                    >
                      {t('finance.tx.equivalent', {
                        amount: money(transaction.amountBase, transaction.baseCurrency as Currency),
                        currency: transaction.baseCurrency,
                      })}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => void removeTransaction(transaction.id)}
                  aria-label={t('finance.cancel')}
                  className="text-xs text-[var(--puls-ink-muted)]"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
          {transactions.length === 0 && !loading ? (
            <li className="py-3 text-sm text-[var(--puls-ink-muted)]" data-testid="transactions-empty">
              {t('finance.transactions.empty')}
            </li>
          ) : null}
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
        <h2 className="text-lg font-bold">{t('finance.budgets')}</h2>

        <ul className="flex min-h-24 flex-col gap-3" data-testid="finance-budgets">
          {budgets.map((budget) => (
            <li key={budget.id} className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{budget.categoryName}</span>
                <span className="text-[var(--puls-ink-muted)]">
                  {t('finance.budget.spent', {
                    spent: money(budget.spent),
                    limit: money(budget.limit),
                  })}
                </span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-[var(--radius-chip)] bg-[var(--puls-line)]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={Math.max(budget.limit, budget.spent)}
                aria-valuenow={budget.spent}
                aria-label={budget.categoryName}
              >
                <div
                  className="h-full rounded-[var(--radius-chip)]"
                  style={{
                    width: `${Math.min(budget.percent, 100)}%`,
                    backgroundColor: LEVEL_COLOR[budget.level],
                  }}
                />
              </div>
              <span className="text-xs" style={{ color: LEVEL_TEXT_COLOR[budget.level] }}>
                {t(`finance.budget.level.${budget.level}`)}
              </span>
            </li>
          ))}
          {budgets.length === 0 && !loading ? (
            <li className="text-sm text-[var(--puls-ink-muted)]" data-testid="budgets-empty">
              {t('finance.budget.empty')}
            </li>
          ) : null}
        </ul>

        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void addBudget(event)}>
          <label htmlFor="budget-category" className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.filter.category')}</span>
            <select
              id="budget-category"
              data-testid="budget-category"
              value={budgetCategory}
              onChange={(event) => setBudgetCategory(event.target.value)}
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            >
              <option value="">{t('finance.filter.all')}</option>
              {expenseCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="budget-limit" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.budget.limit')}</span>
            <input
              id="budget-limit"
              data-testid="budget-limit"
              inputMode="decimal"
              value={budgetLimit}
              onChange={(event) => setBudgetLimit(event.target.value)}
              className="h-10 w-32 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="h-10 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
          >
            {t('finance.budget.add')}
          </button>
        </form>
      </section>
    </div>
  );
}
