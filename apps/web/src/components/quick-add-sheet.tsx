// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useEffect, useState } from 'react';
import {
  guessCategoryName,
  parseQuickTransaction,
  type AccountDto,
  type CategoryDto,
  type TransactionKind,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { formatMoneyLocale } from '@/lib/format';
import { financeApi, notifyFinanceChanged } from '@/lib/finance-client';

/**
 * Шторка быстрого добавления (ТЗ §3.2, §8 пункт 4): строка «обед 450» или
 * сумма + категория + необязательный комментарий — за три нажатия.
 */
export function QuickAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useT();

  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionKind>('expense');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSaved(false);
    setError(null);
    void Promise.all([financeApi.accounts(), financeApi.categories()])
      .then(([accountList, categoryList]) => {
        setAccounts(accountList.accounts);
        setCategories(categoryList.categories);
        setAccountId((previous) => previous || accountList.accounts[0]?.id || '');
      })
      .catch(() => setError(t('finance.quick.noAccount')));
  }, [open, t]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const parsed = parseQuickTransaction(text);
  const guessedName = parsed ? guessCategoryName(parsed.title) : null;
  const guessedCategory = guessedName
    ? categories.find((category) => category.name === guessedName)
    : undefined;
  const effectiveType: TransactionKind = parsed?.type ?? type;
  const effectiveAmount = parsed?.amount ?? Number(amount.replace(',', '.'));
  const showAmount = Number.isFinite(effectiveAmount) && effectiveAmount > 0;
  const visibleCategories = categories.filter((category) =>
    effectiveType === 'income' ? category.kind === 'income' : category.kind === 'expense',
  );

  // Валюты счетов и выбор валюты в форме транзакции (ТЗ §3.2). Валюта
  // транзакции равна валюте выбранного счёта, поэтому выбор валюты сужает счёт.
  const accountCurrencies = [...new Set(accounts.map((account) => account.currency))].sort();
  const effectiveCurrency =
    currencyFilter && accountCurrencies.includes(currencyFilter)
      ? currencyFilter
      : accounts.find((account) => account.id === accountId)?.currency ?? accountCurrencies[0] ?? '';
  const visibleAccounts =
    accountCurrencies.length > 1
      ? accounts.filter((account) => account.currency === effectiveCurrency)
      : accounts;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!accountId) {
      setError(t('finance.quick.noAccount'));
      return;
    }
    if (!text.trim() && !showAmount) {
      setError(t('finance.quick.amount'));
      return;
    }

    setBusy(true);
    try {
      if (text.trim() && parsed) {
        await financeApi.quickTransaction(text.trim(), accountId);
      } else {
        await financeApi.createTransaction({
          accountId,
          categoryId: categoryId || undefined,
          type: effectiveType === 'transfer' ? 'expense' : effectiveType,
          amount: effectiveAmount,
          comment: comment.trim() || undefined,
        });
      }
      setSaved(true);
      setText('');
      setAmount('');
      setComment('');
      notifyFinanceChanged();
      window.setTimeout(onClose, 600);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : t('auth.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-5"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={t('finance.quick.title')}
        data-testid="quick-add-sheet"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
        className="flex w-full max-w-md flex-col gap-4 rounded-t-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-lg sm:rounded-[var(--radius-card)]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">{t('finance.quick.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('finance.close')}
            className="rounded-[var(--radius-button)] px-3 py-2 text-sm text-[var(--puls-ink-muted)]"
          >
            ✕
          </button>
        </div>

        <label htmlFor="quick-text" className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('finance.quick.amount')}</span>
          <input
            id="quick-text"
            data-testid="quick-add-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('finance.quick.example')}
            autoComplete="off"
            className="h-12 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-4 text-base outline-none focus:border-[var(--puls-primary)] focus:ring-2 focus:ring-[var(--puls-primary)]/30"
          />
        </label>

        {text.trim() && parsed ? (
          <p className="text-sm text-[var(--puls-ink-muted)]" data-testid="quick-add-preview">
            {t('finance.quick.parsed', { amount: formatMoneyLocale(parsed.amount, locale) })}
            {guessedCategory ? ` · ${guessedCategory.name}` : ''}
          </p>
        ) : (
          <label htmlFor="quick-amount" className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('finance.quick.amount')}</span>
            <input
              id="quick-amount"
              data-testid="quick-add-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="h-12 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-4 text-base outline-none focus:border-[var(--puls-primary)] focus:ring-2 focus:ring-[var(--puls-primary)]/30"
            />
          </label>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t('finance.quick.category')}</legend>
          <div className="flex flex-wrap gap-2">
            {visibleCategories.map((category) => {
              const isGuessed = guessedCategory?.id === category.id;
              const isActive = isGuessed || categoryId === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setCategoryId(category.id)}
                  aria-pressed={isActive}
                  className="rounded-[var(--radius-chip)] border px-3 py-1.5 text-sm"
                  style={{
                    borderColor: category.color,
                    backgroundColor: isActive ? `${category.color}22` : 'transparent',
                  }}
                >
                  {category.name}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="flex gap-2" role="group" aria-label={t('finance.filter.type')}>
          {(['expense', 'income'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setType(kind)}
              aria-pressed={effectiveType === kind}
              className="flex-1 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 px-3 py-2 text-sm"
              style={{
                backgroundColor: effectiveType === kind ? 'var(--puls-primary)' : 'transparent',
                color: effectiveType === kind ? '#fff' : 'inherit',
              }}
            >
              {t(`finance.type.${kind}`)}
            </button>
          ))}
        </div>

        {accounts.length > 1 ? (
          <div className="flex flex-col gap-3">
            {accountCurrencies.length > 1 ? (
              <label htmlFor="quick-currency" className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('finance.tx.currency')}</span>
                <select
                  id="quick-currency"
                  data-testid="quick-add-currency"
                  value={effectiveCurrency}
                  onChange={(event) => {
                    const next = event.target.value;
                    setCurrencyFilter(next);
                    const match = accounts.find((account) => account.currency === next);
                    if (match) setAccountId(match.id);
                  }}
                  className="h-12 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-4 text-base"
                >
                  {accountCurrencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label htmlFor="quick-account" className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('finance.filter.account')}</span>
              <select
                id="quick-account"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                className="h-12 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-4 text-base"
              >
                {visibleAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <label htmlFor="quick-comment" className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('finance.quick.comment')}</span>
          <input
            id="quick-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            className="h-12 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-4 text-base outline-none focus:border-[var(--puls-primary)]"
          />
        </label>

        {error ? (
          <p role="alert" className="text-sm text-[var(--puls-warning-text)]">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm text-[var(--puls-finance-text)]">
            {t('finance.quick.saved')}
          </p>
        ) : null}

        <button
          type="submit"
          data-testid="quick-add-submit"
          disabled={busy}
          className="h-12 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
        >
          {t('finance.quick.submit')}
        </button>
      </form>
    </div>
  );
}
