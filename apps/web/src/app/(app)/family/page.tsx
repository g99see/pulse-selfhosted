// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  FAMILY_ACCOUNT_TYPES,
  type Currency,
  type FamilyAccountDto,
  type FamilyAccountType,
  type FamilyDto,
  type FamilyGoalDto,
  type FamilyTransactionKind,
  type FamilyTransactionDto,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { MASKED_AMOUNT } from '@/components/money';
import { Alert, EmptyState, IconBubble, Badge } from '@/components/ui';
import { ProgressRing } from '@/components/progress-ring';
import { formatDate, formatMoneyLocale } from '@/lib/format';
import { familyApi } from '@/lib/family-client';
import { useQuietMode } from '@/lib/use-quiet-mode';

function parseAmount(value: string): number {
  return Number(value.replace(',', '.'));
}

const ACCOUNT_TYPE_KEY: Record<FamilyAccountType, string> = {
  card: 'family.accountType.card',
  cash: 'family.accountType.cash',
  savings: 'family.accountType.savings',
};

/** Экран «Семья» (ТЗ §4): общие счета и цели, участники и приглашения. */
export default function FamilyPage() {
  const { t, locale } = useT();
  const quiet = useQuietMode();

  const [family, setFamily] = useState<FamilyDto | null>(null);
  const [accounts, setAccounts] = useState<FamilyAccountDto[]>([]);
  const [transactions, setTransactions] = useState<Record<string, FamilyTransactionDto[]>>({});
  const [goals, setGoals] = useState<FamilyGoalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<FamilyAccountType>('card');
  const [accountBalance, setAccountBalance] = useState('');

  const [txAccount, setTxAccount] = useState<string | null>(null);
  const [txKind, setTxKind] = useState<FamilyTransactionKind>('income');
  const [txAmount, setTxAmount] = useState('');
  const [txNote, setTxNote] = useState('');

  const [goalTitle, setGoalTitle] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [depositGoal, setDepositGoal] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState('');

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const { family: current } = await familyApi.get();
      setFamily(current);
      if (current) {
        const [accountsResponse, goalsResponse] = await Promise.all([
          familyApi.accounts(),
          familyApi.goals(),
        ]);
        setAccounts(accountsResponse.accounts);
        setGoals(goalsResponse.goals);
      } else {
        setAccounts([]);
        setGoals([]);
      }
      setError(null);
    } catch {
      setError(t('family.error.generic'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const money = useCallback(
    (amount: number, currency = 'RUB'): string =>
      quiet ? MASKED_AMOUNT : formatMoneyLocale(amount, locale, currency as Currency),
    [locale, quiet],
  );

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(t('family.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function createFamily(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!newName.trim()) {
      setError(t('family.error.name'));
      return;
    }
    await run(async () => {
      await familyApi.create({ name: newName.trim() });
      setNewName('');
      setNotice(t('family.notice.created'));
      await reload();
    });
  }

  async function joinFamily(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!joinCode.trim()) {
      setError(t('family.error.code'));
      return;
    }
    await run(async () => {
      await familyApi.join(joinCode.trim());
      setJoinCode('');
      setNotice(t('family.notice.joined'));
      await reload();
    });
  }

  async function makeInvite(): Promise<void> {
    await run(async () => {
      const invite = await familyApi.invite();
      setInviteCode(invite.code);
      setNotice(t('family.notice.invited'));
    });
  }

  async function copyInvite(): Promise<void> {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setNotice(t('family.notice.copied'));
    } catch {
      setError(t('family.error.copy'));
    }
  }

  async function leave(): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm(t('family.leaveConfirm'))) return;
    await run(async () => {
      await familyApi.leave();
      await reload();
    });
  }

  async function removeFamily(): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm(t('family.deleteConfirm'))) return;
    await run(async () => {
      await familyApi.remove();
      setInviteCode(null);
      await reload();
    });
  }

  async function removeMember(userId: string): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm(t('family.removeMemberConfirm'))) return;
    await run(async () => {
      await familyApi.removeMember(userId);
      await reload();
    });
  }

  async function createAccount(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!accountName.trim()) {
      setError(t('family.error.name'));
      return;
    }
    const balance = accountBalance.trim() ? parseAmount(accountBalance) : 0;
    if (!Number.isFinite(balance) || balance < 0) {
      setError(t('family.error.amount'));
      return;
    }
    await run(async () => {
      await familyApi.createAccount({ name: accountName.trim(), type: accountType, balance });
      setAccountName('');
      setAccountBalance('');
      setNotice(t('family.notice.accountCreated'));
      await reload();
    });
  }

  async function loadTransactions(accountId: string): Promise<void> {
    await run(async () => {
      const response = await familyApi.transactions(accountId);
      setTransactions((prev) => ({ ...prev, [accountId]: response.transactions }));
      setTxAccount(accountId);
    });
  }

  async function addTransaction(event: React.FormEvent, accountId: string): Promise<void> {
    event.preventDefault();
    const amount = parseAmount(txAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('family.error.amount'));
      return;
    }
    await run(async () => {
      await familyApi.addTransaction(accountId, {
        kind: txKind,
        amount,
        note: txNote.trim() || undefined,
      });
      setTxAmount('');
      setTxNote('');
      setNotice(t('family.notice.txDone'));
      await reload();
      const response = await familyApi.transactions(accountId);
      setTransactions((prev) => ({ ...prev, [accountId]: response.transactions }));
    });
  }

  async function removeAccount(accountId: string): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm(t('family.accountDeleteConfirm'))) return;
    await run(async () => {
      await familyApi.removeAccount(accountId);
      await reload();
    });
  }

  async function createGoal(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const target = parseAmount(goalTarget);
    if (!goalTitle.trim()) {
      setError(t('family.error.name'));
      return;
    }
    if (!Number.isFinite(target) || target <= 0) {
      setError(t('family.error.amount'));
      return;
    }
    await run(async () => {
      await familyApi.createGoal({
        title: goalTitle.trim(),
        targetAmount: target,
        deadline: goalDeadline || undefined,
      });
      setGoalTitle('');
      setGoalTarget('');
      setGoalDeadline('');
      setNotice(t('family.notice.goalCreated'));
      await reload();
    });
  }

  async function deposit(goal: FamilyGoalDto, event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const amount = parseAmount(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('family.error.amount'));
      return;
    }
    await run(async () => {
      await familyApi.depositGoal(goal.id, amount);
      setDepositAmount('');
      setDepositGoal(null);
      setNotice(t('family.notice.depositDone'));
      await reload();
    });
  }

  async function removeGoal(goalId: string): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm(t('family.goalDeleteConfirm'))) return;
    await run(async () => {
      await familyApi.removeGoal(goalId);
      await reload();
    });
  }

  const isOwner = family?.role === 'owner';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <IconBubble name="users" tone="wellbeing" size={48} />
        <h1 className="text-2xl font-extrabold">{t('family.title')}</h1>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {!family && !loading ? (
        <section className="flex flex-col gap-4 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
          <EmptyState icon="users" tone="wellbeing" title={t('family.none')} />
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => void createFamily(event)}
          >
            <label htmlFor="family-name" className="flex flex-1 flex-col gap-1">
              <span className="text-xs text-[var(--puls-ink-muted)]">{t('family.name')}</span>
              <input
                id="family-name"
                data-testid="family-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
              />
            </label>
            <button
              type="submit"
              data-testid="family-create"
              disabled={busy}
              className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
            >
              {t('family.createSubmit')}
            </button>
          </form>

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => void joinFamily(event)}
          >
            <label htmlFor="family-join-code" className="flex flex-1 flex-col gap-1">
              <span className="text-xs text-[var(--puls-ink-muted)]">{t('family.joinHint')}</span>
              <input
                id="family-join-code"
                data-testid="family-join-code"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
              />
            </label>
            <button
              type="submit"
              data-testid="family-join"
              disabled={busy}
              className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-finance-soft)] px-4 text-sm font-semibold text-[var(--puls-finance-text)] disabled:opacity-50"
            >
              {t('family.joinSubmit')}
            </button>
          </form>
        </section>
      ) : null}

      {family ? (
        <>
          <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2
                className="flex items-center gap-2 font-heading text-lg font-bold"
                data-testid="family-name-label"
              >
                {family.name}
              </h2>
              <Badge tone="wellbeing">{t(`family.role.${family.role}`)}</Badge>
            </div>

            <ul className="flex flex-col gap-2" data-testid="family-members">
              {family.members.map((member) => (
                <li
                  key={member.userId}
                  data-testid="family-member"
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-button)] bg-[var(--puls-surface-2)] px-3 py-2"
                >
                  <span className="flex items-center gap-3 text-sm">
                    <span
                      aria-hidden="true"
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--puls-wellbeing-soft)] font-heading text-sm font-extrabold text-[var(--puls-wellbeing-text)]"
                    >
                      {member.nickname.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="font-medium">@{member.nickname}</span>
                    <span className="text-[var(--puls-ink-muted)]">
                      {t(`family.role.${member.role}`)}
                    </span>
                  </span>
                  {isOwner && member.role !== 'owner' ? (
                    <button
                      type="button"
                      data-testid="family-member-remove"
                      onClick={() => void removeMember(member.userId)}
                      className="text-xs text-[var(--puls-ink-muted)]"
                    >
                      {t('family.removeMember')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>

            {isOwner ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-testid="family-invite-create"
                  onClick={() => void makeInvite()}
                  disabled={busy}
                  className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
                >
                  {t('family.inviteSubmit')}
                </button>
                {inviteCode ? (
                  <span className="flex items-center gap-2">
                    <code
                      data-testid="family-invite-code"
                      className="rounded-[var(--radius-chip)] bg-[var(--puls-bg)] px-3 py-1 text-sm"
                    >
                      {inviteCode}
                    </code>
                    <button
                      type="button"
                      data-testid="family-invite-copy"
                      onClick={() => void copyInvite()}
                      className="text-xs text-[var(--puls-ink-muted)]"
                    >
                      {t('family.copy')}
                    </button>
                  </span>
                ) : (
                  <span className="text-xs text-[var(--puls-ink-muted)]">
                    {t('family.inviteHint')}
                  </span>
                )}
              </div>
            ) : (
              <button
                type="button"
                data-testid="family-leave"
                onClick={() => void leave()}
                className="self-start text-xs text-[var(--puls-ink-muted)]"
              >
                {t('family.leave')}
              </button>
            )}

            {isOwner ? (
              <button
                type="button"
                data-testid="family-delete"
                onClick={() => void removeFamily()}
                className="self-start text-xs text-[var(--puls-ink-muted)]"
              >
                {t('family.delete')}
              </button>
            ) : null}
          </section>

          <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-heading text-lg font-bold">
              <IconBubble name="wallet" tone="finance" size={32} />
              {t('family.accounts')}
            </h2>

            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => void createAccount(event)}
            >
              <label htmlFor="family-account-name" className="flex flex-1 flex-col gap-1">
                <span className="text-xs text-[var(--puls-ink-muted)]">
                  {t('family.account.name')}
                </span>
                <input
                  id="family-account-name"
                  data-testid="family-account-name"
                  value={accountName}
                  onChange={(event) => setAccountName(event.target.value)}
                  className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                />
              </label>
              <label htmlFor="family-account-type" className="flex flex-col gap-1">
                <span className="text-xs text-[var(--puls-ink-muted)]">
                  {t('family.account.type')}
                </span>
                <select
                  id="family-account-type"
                  data-testid="family-account-type"
                  value={accountType}
                  onChange={(event) => setAccountType(event.target.value as FamilyAccountType)}
                  className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                >
                  {FAMILY_ACCOUNT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(ACCOUNT_TYPE_KEY[type])}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="family-account-balance" className="flex flex-col gap-1">
                <span className="text-xs text-[var(--puls-ink-muted)]">
                  {t('family.account.balance')}
                </span>
                <input
                  id="family-account-balance"
                  data-testid="family-account-balance"
                  inputMode="decimal"
                  value={accountBalance}
                  onChange={(event) => setAccountBalance(event.target.value)}
                  className="h-11 w-32 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                />
              </label>
              <button
                type="submit"
                data-testid="family-account-create"
                disabled={busy}
                className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
              >
                {t('family.account.create')}
              </button>
            </form>

            {accounts.map((account) => (
              <article
                key={account.id}
                data-testid="family-account"
                className="flex flex-col gap-3 rounded-[var(--radius-tile)] bg-[var(--puls-surface-2)] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex flex-col">
                    <span className="font-medium">{account.name}</span>
                    <span className="text-xs text-[var(--puls-ink-muted)]">
                      {t(ACCOUNT_TYPE_KEY[account.type])} ·{' '}
                      {money(account.balance, account.currency)}
                    </span>
                  </span>
                  <button
                    type="button"
                    data-testid="family-account-delete"
                    onClick={() => void removeAccount(account.id)}
                    className="text-xs text-[var(--puls-ink-muted)]"
                  >
                    {t('family.account.delete')}
                  </button>
                </div>

                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(event) => void addTransaction(event, account.id)}
                >
                  <label htmlFor={`family-tx-kind-${account.id}`} className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--puls-ink-muted)]">
                      {t('family.tx.kind')}
                    </span>
                    <select
                      id={`family-tx-kind-${account.id}`}
                      data-testid="family-tx-kind"
                      value={txAccount === account.id ? txKind : 'income'}
                      onFocus={() => setTxAccount(account.id)}
                      onChange={(event) => {
                        setTxAccount(account.id);
                        setTxKind(event.target.value as FamilyTransactionKind);
                      }}
                      className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                    >
                      <option value="income">{t('family.tx.income')}</option>
                      <option value="expense">{t('family.tx.expense')}</option>
                    </select>
                  </label>
                  <label htmlFor={`family-tx-amount-${account.id}`} className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--puls-ink-muted)]">
                      {t('family.tx.amount')}
                    </span>
                    <input
                      id={`family-tx-amount-${account.id}`}
                      data-testid="family-tx-amount"
                      inputMode="decimal"
                      value={txAccount === account.id ? txAmount : ''}
                      onFocus={() => setTxAccount(account.id)}
                      onChange={(event) => {
                        setTxAccount(account.id);
                        setTxAmount(event.target.value);
                      }}
                      className="h-11 w-28 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                    />
                  </label>
                  <label
                    htmlFor={`family-tx-note-${account.id}`}
                    className="flex flex-1 flex-col gap-1"
                  >
                    <span className="text-xs text-[var(--puls-ink-muted)]">
                      {t('family.tx.note')}
                    </span>
                    <input
                      id={`family-tx-note-${account.id}`}
                      data-testid="family-tx-note"
                      value={txAccount === account.id ? txNote : ''}
                      onFocus={() => setTxAccount(account.id)}
                      onChange={(event) => {
                        setTxAccount(account.id);
                        setTxNote(event.target.value);
                      }}
                      className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                    />
                  </label>
                  <button
                    type="submit"
                    data-testid="family-tx-submit"
                    disabled={busy}
                    className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-finance-soft)] px-4 text-sm font-semibold text-[var(--puls-finance-text)] disabled:opacity-50"
                  >
                    {t('family.tx.submit')}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => void loadTransactions(account.id)}
                  className="self-start text-xs text-[var(--puls-ink-muted)]"
                >
                  {t('family.tx.history')}
                </button>
                <ul data-testid="family-tx-list" className="flex flex-col gap-1">
                  {(transactions[account.id] ?? []).map((tx) => (
                    <li key={tx.id} className="text-xs text-[var(--puls-ink-muted)]">
                      {t(`family.tx.${tx.kind}`)} · {money(tx.amount, account.currency)}
                      {tx.nickname ? ` · @${tx.nickname}` : ''}
                      {tx.note ? ` · ${tx.note}` : ''}
                    </li>
                  ))}
                </ul>
              </article>
            ))}

            {accounts.length === 0 ? (
              <div data-testid="family-accounts-empty">
                <EmptyState icon="wallet" tone="finance" title={t('family.accounts.empty')} />
              </div>
            ) : null}
          </section>

          <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-heading text-lg font-bold">
              <IconBubble name="target" tone="finance" size={32} />
              {t('family.goals')}
            </h2>

            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => void createGoal(event)}
            >
              <label htmlFor="family-goal-title" className="flex flex-1 flex-col gap-1">
                <span className="text-xs text-[var(--puls-ink-muted)]">
                  {t('family.goal.title')}
                </span>
                <input
                  id="family-goal-title"
                  data-testid="family-goal-title"
                  value={goalTitle}
                  onChange={(event) => setGoalTitle(event.target.value)}
                  className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                />
              </label>
              <label htmlFor="family-goal-target" className="flex flex-col gap-1">
                <span className="text-xs text-[var(--puls-ink-muted)]">
                  {t('family.goal.target')}
                </span>
                <input
                  id="family-goal-target"
                  data-testid="family-goal-target"
                  inputMode="decimal"
                  value={goalTarget}
                  onChange={(event) => setGoalTarget(event.target.value)}
                  className="h-11 w-32 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                />
              </label>
              <label htmlFor="family-goal-deadline" className="flex flex-col gap-1">
                <span className="text-xs text-[var(--puls-ink-muted)]">
                  {t('family.goal.deadline')}
                </span>
                <input
                  id="family-goal-deadline"
                  data-testid="family-goal-deadline"
                  type="date"
                  value={goalDeadline}
                  onChange={(event) => setGoalDeadline(event.target.value)}
                  className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                />
              </label>
              <button
                type="submit"
                data-testid="family-goal-create"
                disabled={busy}
                className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
              >
                {t('family.goal.create')}
              </button>
            </form>

            <div className="grid gap-3 md:grid-cols-2">
              {goals.map((goal) => (
                <article
                  key={goal.id}
                  data-testid="family-goal"
                  className="flex flex-col gap-3 rounded-[var(--radius-tile)] bg-[var(--puls-surface-2)] p-4"
                >
                  <div className="flex items-center gap-4">
                    <ProgressRing
                      size={88}
                      stroke={10}
                      percent={goal.percent}
                      label={t('family.goal.progress', { percent: goal.percent })}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-lg font-bold">{goal.title}</span>
                      <span className="text-sm text-[var(--puls-ink-muted)]">
                        {t('family.goal.saved')}: {money(goal.savedAmount, goal.currency)} /{' '}
                        {money(goal.targetAmount, goal.currency)} · {t('family.goal.remaining')}:{' '}
                        {money(goal.remaining, goal.currency)}
                      </span>
                      <span className="text-sm text-[var(--puls-ink-muted)]">
                        {goal.forecastDate
                          ? t('family.goal.forecast', {
                              date: formatDate(goal.forecastDate, locale, { dateStyle: 'medium' }),
                            })
                          : t('family.goal.forecastUnknown')}
                      </span>
                      <span className="text-xs text-[var(--puls-ink-muted)]">
                        {goal.deposits
                          .map(
                            (deposit) =>
                              `${deposit.nickname ? `@${deposit.nickname}: ` : ''}${money(deposit.amount, goal.currency)}`,
                          )
                          .join(', ')}
                      </span>
                    </div>
                    <button
                      type="button"
                      data-testid="family-goal-delete"
                      onClick={() => void removeGoal(goal.id)}
                      className="self-start text-xs text-[var(--puls-ink-muted)]"
                    >
                      {t('family.goal.delete')}
                    </button>
                  </div>

                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => void deposit(goal, event)}
                  >
                    <label
                      htmlFor={`family-goal-deposit-${goal.id}`}
                      className="flex flex-col gap-1"
                    >
                      <span className="text-xs text-[var(--puls-ink-muted)]">
                        {t('family.goal.depositAmount')}
                      </span>
                      <input
                        id={`family-goal-deposit-${goal.id}`}
                        data-testid="family-goal-deposit-amount"
                        inputMode="decimal"
                        value={depositGoal === goal.id ? depositAmount : ''}
                        onFocus={() => setDepositGoal(goal.id)}
                        onChange={(event) => {
                          setDepositGoal(goal.id);
                          setDepositAmount(event.target.value);
                        }}
                        className="h-11 w-32 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                      />
                    </label>
                    <button
                      type="submit"
                      data-testid="family-goal-deposit-submit"
                      disabled={busy || depositGoal !== goal.id}
                      className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-finance-soft)] px-4 text-sm font-semibold text-[var(--puls-finance-text)] disabled:opacity-50"
                    >
                      {t('family.goal.depositSubmit')}
                    </button>
                  </form>
                </article>
              ))}
            </div>

            {goals.length === 0 ? (
              <div data-testid="family-goals-empty">
                <EmptyState icon="target" tone="finance" title={t('family.goals.empty')} />
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
