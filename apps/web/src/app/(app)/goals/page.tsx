// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  GOAL_EMOJI_PRESETS,
  isGoalImageUrl,
  type AccountDto,
  type Currency,
  type GoalDto,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { MASKED_AMOUNT } from '@/components/money';
import { Alert, Card, EmptyState, IconBubble } from '@/components/ui';
import { ProgressRing } from '@/components/progress-ring';
import { financeApi } from '@/lib/finance-client';
import { formatDate, formatMoneyLocale } from '@/lib/format';
import { goalsApi, notifyGoalsChanged } from '@/lib/goals-client';
import { useQuietMode } from '@/lib/use-quiet-mode';

function parseAmount(value: string): number {
  return Number(value.replace(',', '.'));
}

function GoalImage({ image }: { image: string | null }) {
  if (!image) return null;
  if (isGoalImageUrl(image)) {
    return (
      <img src={image} alt="" className="h-8 w-8 rounded-[var(--radius-button)] object-cover" />
    );
  }
  return (
    <span aria-hidden="true" className="text-2xl leading-none">
      {image}
    </span>
  );
}

/** Экран «Цели накоплений» (ТЗ §3.2, §8): кольца, форма цели и пополнения. */
export default function GoalsPage() {
  const { t, locale } = useT();
  const quiet = useQuietMode();

  const [goals, setGoals] = useState<GoalDto[]>([]);
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');
  const [emoji, setEmoji] = useState<string>(GOAL_EMOJI_PRESETS[0]);
  const [imageUrl, setImageUrl] = useState('');
  const [accountId, setAccountId] = useState('');

  const [depositGoal, setDepositGoal] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState('');

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [list, accountsResponse] = await Promise.all([goalsApi.list(), financeApi.accounts()]);
      setGoals(list.goals);
      setAccounts(accountsResponse.accounts);
      setError(null);
    } catch {
      setError(t('goals.error.generic'));
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

  async function addGoal(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const targetAmount = parseAmount(target);
    if (!title.trim()) {
      setError(t('goals.error.titleRequired'));
      return;
    }
    if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
      setError(t('goals.error.amount'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await goalsApi.create({
        title: title.trim(),
        targetAmount,
        deadline: deadline || undefined,
        image: imageUrl.trim() || emoji,
        accountId: accountId || undefined,
      });
      setTitle('');
      setTarget('');
      setDeadline('');
      setImageUrl('');
      setNotice(t('goals.form.submit'));
      notifyGoalsChanged();
      await reload();
    } catch {
      setError(t('goals.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function deposit(goal: GoalDto, event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const amount = parseAmount(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('goals.error.amount'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await goalsApi.deposit(goal.id, { amount });
      const reached = result.milestone.reached;
      setNotice(
        reached.length > 0
          ? t('goals.deposit.milestone', { percent: reached[reached.length - 1] })
          : t('goals.deposit.done'),
      );
      setDepositAmount('');
      setDepositGoal(null);
      notifyGoalsChanged();
      await reload();
    } catch {
      setError(t('goals.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function removeGoal(goal: GoalDto): Promise<void> {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(t('goals.deleteConfirm', { title: goal.title }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await goalsApi.remove(goal.id);
      setNotice(t('goals.deleted'));
      notifyGoalsChanged();
      await reload();
    } catch {
      setError(t('goals.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  const savingsAccounts = accounts.filter((account) => account.type === 'savings');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <IconBubble name="target" tone="finance" size={48} />
        <h1 className="text-2xl font-extrabold">{t('goals.title')}</h1>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="flex flex-col gap-3 lg:sticky lg:top-4">
          <h2 className="flex items-center gap-2 font-heading text-lg font-bold">
            <IconBubble name="plus" tone="finance" size={32} />
            {t('goals.add')}
          </h2>
          <form className="flex flex-col gap-3" onSubmit={(event) => void addGoal(event)}>
            <label htmlFor="goal-title" className="flex flex-col gap-1">
              <span className="text-xs text-[var(--puls-ink-muted)]">{t('goals.form.title')}</span>
              <input
                id="goal-title"
                data-testid="goal-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="h-11 w-full rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
              />
            </label>
            <label htmlFor="goal-target" className="flex flex-col gap-1">
              <span className="text-xs text-[var(--puls-ink-muted)]">{t('goals.form.target')}</span>
              <input
                id="goal-target"
                data-testid="goal-target"
                inputMode="decimal"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                className="h-11 w-full rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
              />
            </label>
            <label htmlFor="goal-deadline" className="flex flex-col gap-1">
              <span className="text-xs text-[var(--puls-ink-muted)]">
                {t('goals.form.deadline')}
              </span>
              <input
                id="goal-deadline"
                data-testid="goal-deadline"
                type="date"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
                className="h-11 w-full rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
              />
            </label>
            <label htmlFor="goal-image" className="flex flex-col gap-1">
              <span className="text-xs text-[var(--puls-ink-muted)]">{t('goals.form.image')}</span>
              <select
                id="goal-image"
                data-testid="goal-image"
                value={emoji}
                onChange={(event) => setEmoji(event.target.value)}
                className="h-11 w-full rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
              >
                {GOAL_EMOJI_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="goal-image-url" className="flex flex-col gap-1">
              <span className="text-xs text-[var(--puls-ink-muted)]">
                {t('goals.form.imageHint')}
              </span>
              <input
                id="goal-image-url"
                data-testid="goal-image-url"
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="https://"
                className="h-11 w-full rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
              />
            </label>
            <label htmlFor="goal-account" className="flex flex-col gap-1">
              <span className="text-xs text-[var(--puls-ink-muted)]">
                {t('goals.form.account')}
              </span>
              <select
                id="goal-account"
                data-testid="goal-account"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                className="h-11 w-full rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
              >
                <option value="">{t('goals.form.accountNone')}</option>
                {savingsAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              data-testid="goal-create"
              disabled={busy}
              className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
            >
              {t('goals.form.submit')}
            </button>
          </form>
        </Card>

        {/* Две колонки только с 2xl: на 1280–1440 px карточка выходила ~310 px, названия обрезались до «Bea…». */}
        <section className="grid gap-4 2xl:grid-cols-2" data-testid="goals-list">
          {goals.map((goal) => (
            <article
              key={goal.id}
              data-testid="goal-card"
              className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm"
            >
              <div className="flex items-start gap-4">
                <ProgressRing
                  size={96}
                  stroke={10}
                  percent={goal.percent}
                  label={t('goals.card.progress', { percent: goal.percent, title: goal.title })}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <GoalImage image={goal.image} />
                    <span className="truncate text-lg font-bold">{goal.title}</span>
                  </span>
                  <span className="font-heading text-xl font-extrabold">
                    {money(goal.savedAmount, goal.currency)}{' '}
                    <span className="text-sm font-medium text-[var(--puls-ink-muted)]">
                      / {money(goal.targetAmount, goal.currency)}
                    </span>
                  </span>
                  <span className="text-sm text-[var(--puls-ink-muted)]">
                    {t('goals.remaining')}: {money(goal.remaining, goal.currency)}
                  </span>
                  <span className="text-sm text-[var(--puls-ink-muted)]">
                    {goal.requiredMonthly === null
                      ? t('goals.monthlyUnknown')
                      : t('goals.monthly', { amount: money(goal.requiredMonthly, goal.currency) })}
                  </span>
                  <span className="text-sm text-[var(--puls-ink-muted)]">
                    {goal.forecastDate
                      ? t('goals.forecast', {
                          date: formatDate(goal.forecastDate, locale, { dateStyle: 'medium' }),
                        })
                      : t('goals.forecastUnknown')}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="goal-delete"
                  onClick={() => void removeGoal(goal)}
                  className="self-start rounded-[var(--radius-chip)] px-2 py-1 text-xs text-[var(--puls-ink-muted)] hover:bg-[var(--puls-surface-2)]"
                >
                  {t('goals.delete')}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {goal.milestones.map((milestone) => (
                  <span
                    key={milestone}
                    data-testid="goal-milestone"
                    className="rounded-[var(--radius-chip)] bg-[var(--puls-finance-soft)] px-3 py-1 text-xs font-semibold text-[var(--puls-finance-text)]"
                  >
                    {t('goals.milestone', { percent: milestone })}
                  </span>
                ))}
              </div>

              <form
                className="flex items-end gap-2"
                onSubmit={(event) => void deposit(goal, event)}
              >
                <label
                  htmlFor={`goal-deposit-${goal.id}`}
                  className="flex min-w-0 flex-1 flex-col gap-1"
                >
                  <span className="text-xs text-[var(--puls-ink-muted)]">
                    {t('goals.deposit.amount')}
                  </span>
                  <input
                    id={`goal-deposit-${goal.id}`}
                    data-testid="goal-deposit-amount"
                    inputMode="decimal"
                    value={depositGoal === goal.id ? depositAmount : ''}
                    onFocus={() => setDepositGoal(goal.id)}
                    onChange={(event) => {
                      setDepositGoal(goal.id);
                      setDepositAmount(event.target.value);
                    }}
                    className="h-11 w-full rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                  />
                </label>
                <button
                  type="submit"
                  data-testid="goal-deposit-submit"
                  disabled={busy || depositGoal !== goal.id}
                  className="h-11 shrink-0 rounded-[var(--radius-button)] bg-[var(--puls-finance-soft)] px-4 text-sm font-semibold text-[var(--puls-finance-text)] disabled:opacity-50"
                >
                  {t('goals.deposit.submit')}
                </button>
              </form>
            </article>
          ))}

          {goals.length === 0 && !loading ? (
            <div
              className="rounded-[var(--radius-card)] bg-[var(--puls-surface)] shadow-sm 2xl:col-span-2"
              data-testid="goals-empty"
            >
              <EmptyState icon="target" tone="finance" title={t('goals.empty')} />
            </div>
          ) : null}
          {loading && goals.length === 0 ? (
            <div
              className="min-h-40 rounded-[var(--radius-card)] bg-[var(--puls-surface)] shadow-sm sm:col-span-2"
              aria-hidden="true"
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
