// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
import { categoryLabel } from '@/lib/category-label';
import { Money, MASKED_AMOUNT } from '@/components/money';
import { CategoryManager } from '@/components/category-manager';
import { RecurringSection } from '@/components/recurring-section';
import { Icon } from '@/components/icons';
import { FormToggle } from '@/components/finance-form-toggle';
import {
  Alert,
  Card,
  EmptyState,
  Field,
  GhostButton,
  IconBubble,
  PrimaryButton,
  ProgressBar,
  Segmented,
  Select,
  toneClasses,
  type Tone,
} from '@/components/ui';
import { CURRENCY_OPTIONS } from '@/lib/currency-form';
import { iconGlyph } from '@/lib/category-form';
import { formatDate, formatMoneyLocale } from '@/lib/format';
import { financeApi, FINANCE_CHANGED_EVENT } from '@/lib/finance-client';
import { useQuietMode } from '@/lib/use-quiet-mode';

type FinanceTab = 'ops' | 'accounts' | 'categories' | 'recurring';
const TABS: FinanceTab[] = ['ops', 'accounts', 'categories', 'recurring'];
const PAGE_SIZE = 20;

type AccountTypeOption = { value: AccountType; key: string };
const ACCOUNT_TYPES: AccountTypeOption[] = [
  { value: 'card', key: 'finance.account.card' },
  { value: 'cash', key: 'finance.account.cash' },
  { value: 'savings', key: 'finance.account.savings' },
];

const ACCOUNT_TONE: Record<AccountType, Tone> = {
  card: 'primary',
  cash: 'wellbeing',
  savings: 'finance',
};

/** Тон полосы бюджета по заполнению: до 80% — деньги, 80–100% — самочувствие, выше — предупреждение. */
function budgetTone(budget: BudgetDto): 'finance' | 'wellbeing' | 'warning' {
  if (budget.percent > 100) return 'warning';
  if (budget.percent >= 80) return 'wellbeing';
  return 'finance';
}

function dayKey(date: string): string {
  return date.slice(0, 10);
}

/** Экран «Финансы» (ТЗ §8 пункт 5): вкладки операций, счетов, категорий и регулярных платежей. */
export function FinanceScreen({
  initialOverview = null,
}: {
  /** Сводка, загруженная на сервере: баланс есть уже в первом HTML (LCP), дальше — обычная перезагрузка. */
  initialOverview?: FinanceOverviewResponse | null;
}) {
  const { t, locale } = useT();
  const quiet = useQuietMode();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab');

  const [tab, setTab] = useState<FinanceTab>(
    TABS.includes(initialTab as FinanceTab) ? (initialTab as FinanceTab) : 'ops',
  );

  const [overview, setOverview] = useState<FinanceOverviewResponse | null>(initialOverview);
  const [transactions, setTransactions] = useState<TransactionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

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

  function changeTab(next: FinanceTab): void {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  }

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
    setVisible(PAGE_SIZE);
  }, [filterType, filterCategory, filterAccount]);

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
  const currency = (overview?.currency ?? 'RUB') as Currency;
  // Режим «Тишина» (ТЗ §4): суммы внутри составных строк прячутся одной маской.
  const money = (value: number, currencyCode: Currency = currency): string =>
    quiet ? MASKED_AMOUNT : formatMoneyLocale(value, locale, currencyCode);
  const expenseCategories = categories.filter((category) => category.kind === 'expense');
  const selectedAccountCurrency = accountCurrency || currency;

  // Новые сверху: по дате, при равенстве — по времени создания.
  const sorted = useMemo(
    () =>
      [...transactions].sort(
        (a, b) =>
          dayKey(b.date).localeCompare(dayKey(a.date)) || b.createdAt.localeCompare(a.createdAt),
      ),
    [transactions],
  );
  const shown = sorted.slice(0, visible);
  const groups = useMemo(() => {
    const map = new Map<string, TransactionDto[]>();
    for (const item of shown) {
      const key = dayKey(item.date);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [shown]);

  function dayTitle(key: string): string {
    const now = new Date();
    const today = formatKey(now);
    const yesterday = formatKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    if (key === today) return t('finance.tx.today');
    if (key === yesterday) return t('finance.tx.yesterday');
    return formatDate(`${key}T12:00:00`, locale, { day: 'numeric', month: 'long' });
  }

  function formatKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

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

  async function removeAllTransactions(): Promise<void> {
    if (!window.confirm(t('finance.transactions.deleteAllConfirm'))) return;
    setBusy(true);
    try {
      await financeApi.removeAllTransactions();
      await reload();
    } finally {
      setBusy(false);
    }
  }

  function amountClass(type: TransactionKind): string {
    if (type === 'income') return 'text-[var(--puls-finance-text)]';
    if (type === 'transfer') return 'text-[var(--puls-ink-muted)]';
    return 'text-[var(--puls-ink)]';
  }

  function amountPrefix(type: TransactionKind): string {
    if (type === 'income') return '+';
    if (type === 'transfer') return '';
    return '−';
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-3xl font-extrabold">{t('finance.title')}</h1>
          <p className="text-sm text-[var(--puls-ink-muted)]">{t('finance.total')}</p>
          <p className="min-h-10 font-heading text-4xl font-extrabold text-[var(--puls-finance-text)] [font-variant-numeric:tabular-nums]">
            {overview ? (
              <Money value={overview.totalBalance} currency={currency} testId="finance-total" />
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/finance/import"
            data-testid="import-link"
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-4 text-sm font-semibold text-[var(--puls-primary-text)]"
          >
            {t('finance.import.open')}
          </Link>
          <Link
            href="/finance/rates"
            data-testid="rates-link"
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-chip)] bg-[var(--puls-finance-soft)] px-4 text-sm font-semibold text-[var(--puls-finance-text)]"
          >
            {t('finance.rates.link')}
          </Link>
        </div>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      <Segmented<FinanceTab>
        label={t('finance.tabs.label')}
        fill
        value={tab}
        onChange={changeTab}
        options={[
          { value: 'ops', label: t('finance.tab.ops'), testId: 'finance-tab-ops' },
          { value: 'accounts', label: t('finance.tab.accounts'), testId: 'finance-tab-accounts' },
          {
            value: 'categories',
            label: t('finance.tab.categories'),
            testId: 'finance-tab-categories',
          },
          {
            value: 'recurring',
            label: t('finance.tab.recurring'),
            testId: 'finance-tab-recurring',
          },
        ]}
      />

      {tab === 'ops' ? (
        <>
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-heading text-lg font-bold">{t('finance.transactions')}</h2>
              <button
                type="button"
                data-testid="transactions-delete-all"
                onClick={() => void removeAllTransactions()}
                disabled={busy}
                className="inline-flex h-9 items-center rounded-[var(--radius-chip)] px-3 text-sm font-semibold text-[var(--puls-warning-text)] hover:bg-[var(--puls-surface-2)] disabled:opacity-50"
              >
                {t('finance.transactions.deleteAll')}
              </button>
            </div>

            {/* Фильтры в одну строку и на телефоне: иначе они занимают пол-экрана до первой операции. */}
            <div className="grid min-w-0 grid-cols-3 gap-2 sm:gap-3 [&_select]:min-w-0 [&_select]:truncate [&_select]:px-3">
              <Select
                id="filter-type"
                label={t('finance.filter.type')}
                data-testid="filter-type"
                value={filterType}
                onChange={(event) => setFilterType(event.target.value as 'all' | TransactionKind)}
              >
                <option value="all">{t('finance.filter.all')}</option>
                <option value="expense">{t('finance.type.expense')}</option>
                <option value="income">{t('finance.type.income')}</option>
                <option value="transfer">{t('finance.type.transfer')}</option>
              </Select>
              <Select
                id="filter-category"
                label={t('finance.filter.category')}
                data-testid="filter-category"
                value={filterCategory}
                onChange={(event) => setFilterCategory(event.target.value)}
              >
                <option value="">{t('finance.filter.all')}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {categoryLabel(category, t)}
                  </option>
                ))}
              </Select>
              <Select
                id="filter-account"
                label={t('finance.filter.account')}
                value={filterAccount}
                onChange={(event) => setFilterAccount(event.target.value)}
              >
                <option value="">{t('finance.filter.all')}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex min-h-48 flex-col gap-4" data-testid="finance-transactions">
              {groups.map(([key, items]) => (
                <section key={key} className="flex flex-col gap-1">
                  <h3 className="text-xs font-semibold tracking-wide text-[var(--puls-ink-muted)] uppercase">
                    {dayTitle(key)}
                  </h3>
                  <ul className="flex flex-col">
                    {items.map((transaction) => (
                      <li
                        key={transaction.id}
                        className="flex items-center justify-between gap-3 border-b border-[var(--puls-line)] py-2.5 last:border-b-0"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span
                            aria-hidden="true"
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] text-lg"
                            style={{
                              backgroundColor: transaction.categoryColor
                                ? `${transaction.categoryColor}22`
                                : 'var(--puls-surface-2)',
                            }}
                          >
                            {iconGlyph(transaction.categoryIcon ?? '')}
                          </span>
                          <span className="flex min-w-0 flex-col">
                            <span
                              className="truncate font-medium"
                              data-testid="transaction-category"
                            >
                              {transaction.categoryName
                                ? categoryLabel(
                                    { id: transaction.categoryId, name: transaction.categoryName },
                                    t,
                                  )
                                : t('finance.noCategory')}
                            </span>
                            <span className="truncate text-xs text-[var(--puls-ink-muted)]">
                              {transaction.comment ? `${transaction.comment} · ` : ''}
                              {transaction.accountName}
                            </span>
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="flex flex-col items-end">
                            <span
                              className={`font-semibold [font-variant-numeric:tabular-nums] ${amountClass(transaction.type)}`}
                              data-testid="transaction-amount"
                            >
                              {amountPrefix(transaction.type)}
                              <Money
                                value={transaction.amount}
                                currency={transaction.currency as Currency}
                              />
                            </span>
                            {transaction.currency !== transaction.baseCurrency ? (
                              <span
                                className="text-xs text-[var(--puls-ink-muted)] [font-variant-numeric:tabular-nums]"
                                data-testid="transaction-base"
                              >
                                {t('finance.tx.equivalent', {
                                  amount: money(
                                    transaction.amountBase,
                                    transaction.baseCurrency as Currency,
                                  ),
                                  currency: transaction.baseCurrency,
                                })}
                              </span>
                            ) : null}
                          </span>
                          <button
                            type="button"
                            onClick={() => void removeTransaction(transaction.id)}
                            aria-label={t('finance.cancel')}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--puls-ink-muted)] hover:bg-[var(--puls-surface-2)]"
                          >
                            <Icon name="close" size={14} />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {loading && transactions.length === 0 ? (
                // Скелет строк на время загрузки: список не «выстреливает» с нуля до 20 строк.
                <div aria-hidden="true" className="flex flex-col gap-1">
                  {Array.from({ length: 6 }, (_, index) => (
                    <div key={index} className="flex items-center gap-3 py-2">
                      <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-[var(--puls-surface-2)]" />
                      <span className="h-4 flex-1 animate-pulse rounded-full bg-[var(--puls-surface-2)]" />
                      <span className="h-4 w-20 animate-pulse rounded-full bg-[var(--puls-surface-2)]" />
                    </div>
                  ))}
                </div>
              ) : null}
              {transactions.length === 0 && !loading ? (
                <div data-testid="transactions-empty">
                  <EmptyState
                    tone="finance"
                    icon="wallet"
                    title={t('finance.transactions.empty')}
                  />
                </div>
              ) : null}
              {sorted.length > visible ? (
                <GhostButton
                  type="button"
                  data-testid="transactions-more"
                  onClick={() => setVisible((value) => value + PAGE_SIZE)}
                  className="self-center"
                >
                  {t('finance.tx.more')}
                </GhostButton>
              ) : null}
            </div>
          </Card>

          <Card className="flex flex-col gap-4">
            <h2 className="font-heading text-lg font-bold">{t('finance.budgets')}</h2>

            <ul className="flex min-h-24 flex-col gap-4" data-testid="finance-budgets">
              {budgets.map((budget) => (
                <li key={budget.id} className="flex flex-col gap-1">
                  <ProgressBar
                    value={budget.spent}
                    max={Math.max(budget.limit, 1)}
                    label={categoryLabel({ id: budget.categoryId, name: budget.categoryName }, t)}
                    tone={budgetTone(budget)}
                  />
                  <span className="text-xs text-[var(--puls-ink-muted)]">
                    {t('finance.budget.spent', {
                      spent: money(budget.spent),
                      limit: money(budget.limit),
                    })}
                    {' · '}
                    {t(`finance.budget.level.${budget.level}`)}
                  </span>
                </li>
              ))}
              {loading && budgets.length === 0
                ? Array.from({ length: 3 }, (_, index) => (
                    <li
                      key={`skeleton-${index}`}
                      aria-hidden="true"
                      className="flex flex-col gap-2"
                    >
                      <span className="h-4 w-1/3 animate-pulse rounded-full bg-[var(--puls-surface-2)]" />
                      <span className="h-2.5 w-full animate-pulse rounded-full bg-[var(--puls-surface-2)]" />
                      <span className="h-3 w-1/2 animate-pulse rounded-full bg-[var(--puls-surface-2)]" />
                    </li>
                  ))
                : null}
              {budgets.length === 0 && !loading ? (
                <li data-testid="budgets-empty">
                  <EmptyState tone="finance" icon="target" title={t('finance.budget.empty')} />
                </li>
              ) : null}
            </ul>

            <FormToggle label={t('finance.budget.new')} testId="budget-form-toggle">
              <form
                className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
                onSubmit={(event) => void addBudget(event)}
              >
                <Select
                  id="budget-category"
                  label={t('finance.filter.category')}
                  data-testid="budget-category"
                  value={budgetCategory}
                  onChange={(event) => setBudgetCategory(event.target.value)}
                >
                  <option value="">{t('finance.filter.all')}</option>
                  {expenseCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {categoryLabel(category, t)}
                    </option>
                  ))}
                </Select>
                <Field
                  id="budget-limit"
                  label={t('finance.budget.limit')}
                  data-testid="budget-limit"
                  inputMode="decimal"
                  value={budgetLimit}
                  onChange={(event) => setBudgetLimit(event.target.value)}
                />
                <PrimaryButton type="submit" disabled={busy}>
                  {t('finance.budget.add')}
                </PrimaryButton>
              </form>
            </FormToggle>
          </Card>
        </>
      ) : null}

      {tab === 'accounts' ? (
        <Card className="flex flex-col gap-4">
          <h2 className="font-heading text-lg font-bold">{t('finance.accounts')}</h2>
          <ul
            className="grid min-h-24 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="finance-accounts"
          >
            {accounts.map((account) => (
              <li
                key={account.id}
                className={`flex flex-col gap-3 rounded-[20px] p-4 ${toneClasses(ACCOUNT_TONE[account.type])}`}
              >
                <span className="flex items-center gap-2">
                  <IconBubble name="wallet" tone={ACCOUNT_TONE[account.type]} size={36} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">{account.name}</span>
                    <span className="text-xs opacity-80">
                      {t(`finance.account.${account.type}`)}
                    </span>
                  </span>
                </span>
                <Money
                  value={account.balance}
                  currency={account.currency as Currency}
                  className="font-heading text-2xl font-extrabold text-[var(--puls-ink)] [font-variant-numeric:tabular-nums]"
                />
              </li>
            ))}
            {accounts.length === 0 && !loading ? (
              <li className="sm:col-span-2 lg:col-span-3">
                <EmptyState tone="finance" icon="wallet" title={t('finance.account.add')} />
              </li>
            ) : null}
          </ul>

          <FormToggle label={t('finance.account.new')} testId="account-form-toggle">
            <form
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              onSubmit={(event) => void addAccount(event)}
            >
              <Field
                id="account-name"
                label={t('finance.account.name')}
                data-testid="account-name"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
              />
              <Select
                id="account-type"
                label={t('finance.account.type')}
                value={accountType}
                onChange={(event) => setAccountType(event.target.value as AccountType)}
              >
                {ACCOUNT_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.key)}
                  </option>
                ))}
              </Select>
              <Field
                id="account-balance"
                label={t('finance.account.balance')}
                inputMode="decimal"
                value={accountBalance}
                onChange={(event) => setAccountBalance(event.target.value)}
              />
              <Select
                id="account-currency"
                label={t('finance.account.currency')}
                data-testid="account-currency"
                value={selectedAccountCurrency}
                onChange={(event) => setAccountCurrency(event.target.value)}
              >
                {CURRENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value}
                  </option>
                ))}
              </Select>
              <PrimaryButton
                type="submit"
                disabled={busy}
                className="sm:col-span-2 sm:justify-self-start"
              >
                {t('finance.account.add')}
              </PrimaryButton>
            </form>
          </FormToggle>
        </Card>
      ) : null}

      {tab === 'categories' ? (
        <CategoryManager
          categories={categories}
          loading={loading}
          onChanged={() => void reload()}
        />
      ) : null}

      {tab === 'recurring' ? (
        <RecurringSection
          accounts={accounts}
          categories={categories}
          currency={currency}
          onChanged={() => void reload()}
        />
      ) : null}
    </div>
  );
}
