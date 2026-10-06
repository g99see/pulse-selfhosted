// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import { HABIT_ICON_PRESETS, type HabitStatsItemDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Badge, Card, EmptyState, IconBubble } from '@/components/ui';
import { habitsApi, notifyHabitsChanged } from '@/lib/habits-client';

/** Экран «Привычки» (ТЗ §4, P2): список, добавление, архив, серия и проценты. */
export default function HabitsPage() {
  const { t } = useT();

  const [habits, setHabits] = useState<HabitStatsItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>(HABIT_ICON_PRESETS[0]);
  const [cadence, setCadence] = useState<'daily' | 'weekly'>('daily');
  const [perWeek, setPerWeek] = useState('3');

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await habitsApi.stats();
      setHabits(response.habits);
      setError(null);
    } catch {
      setError(t('habits.error.generic'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function addHabit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) {
      setError(t('habits.error.nameRequired'));
      return;
    }
    const weekly = Math.min(7, Math.max(1, Number(perWeek) || 1));

    setBusy(true);
    setError(null);
    try {
      await habitsApi.create({
        name: name.trim(),
        icon,
        cadence,
        perWeek: cadence === 'weekly' ? weekly : 1,
      });
      setName('');
      setNotice(t('habits.form.submit'));
      notifyHabitsChanged();
      await reload();
    } catch {
      setError(t('habits.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function setArchived(habit: HabitStatsItemDto, archived: boolean): Promise<void> {
    setBusy(true);
    try {
      await habitsApi.update(habit.id, { archived });
      setNotice(archived ? t('habits.archive.done') : t('habits.restore.done'));
      notifyHabitsChanged();
      await reload();
    } catch {
      setError(t('habits.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function removeHabit(habit: HabitStatsItemDto): Promise<void> {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(t('habits.deleteConfirm', { name: habit.name }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await habitsApi.remove(habit.id);
      setNotice(t('habits.deleted'));
      notifyHabitsChanged();
      await reload();
    } catch {
      setError(t('habits.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  const active = habits.filter((habit) => !habit.archived);
  const archived = habits.filter((habit) => habit.archived);

  function HabitRow({ habit }: { habit: HabitStatsItemDto }) {
    return (
      <article
        data-testid="habit-card"
        className={`flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm ${habit.archived ? 'opacity-80' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-[var(--puls-wellbeing-soft)] text-2xl leading-none"
          >
            {habit.icon}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-lg font-bold">{habit.name}</span>
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {habit.cadence === 'weekly'
                ? t('habits.cadence.weeklyTarget', { count: habit.perWeek })
                : t('habits.cadence.daily')}
            </span>
          </span>
          <button
            type="button"
            data-testid="habit-delete"
            onClick={() => void removeHabit(habit)}
            disabled={busy}
            className="rounded-[var(--radius-chip)] px-2 py-1 text-xs text-[var(--puls-ink-muted)] hover:bg-[var(--puls-surface-2)] disabled:opacity-50"
          >
            {t('habits.delete')}
          </button>
        </div>
        <span className="flex flex-wrap gap-2">
          <span data-testid="habit-streak">
            <Badge tone={habit.streak > 0 ? 'wellbeing' : 'neutral'}>
              {habit.streak > 0
                ? t('habits.streak', { days: habit.streak })
                : t('habits.streak.none')}
            </Badge>
          </span>
          <span data-testid="habit-rate7">
            <Badge tone="primary">{t('habits.rate7', { percent: habit.rate7 })}</Badge>
          </span>
          <span data-testid="habit-rate30">
            <Badge tone="finance">{t('habits.rate30', { percent: habit.rate30 })}</Badge>
          </span>
        </span>
        <button
          type="button"
          data-testid={habit.archived ? 'habit-restore' : 'habit-archive'}
          onClick={() => void setArchived(habit, !habit.archived)}
          disabled={busy}
          className="w-fit rounded-[var(--radius-chip)] bg-[var(--puls-surface-2)] px-3.5 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {habit.archived ? t('habits.restore') : t('habits.archive')}
        </button>
      </article>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <IconBubble name="repeat" tone="wellbeing" size={44} />
        <h1 className="text-2xl font-extrabold">{t('habits.title')}</h1>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--puls-warning-text)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-[var(--puls-wellbeing-text)]">
          {notice}
        </p>
      ) : null}

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">{t('habits.add')}</h2>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void addHabit(event)}>
          <label htmlFor="habit-name" className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('habits.form.name')}</span>
            <input
              id="habit-name"
              data-testid="habit-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            />
          </label>
          <label htmlFor="habit-icon" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('habits.form.icon')}</span>
            <select
              id="habit-icon"
              data-testid="habit-icon"
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
              className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            >
              {HABIT_ICON_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="habit-cadence" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('habits.form.cadence')}</span>
            <select
              id="habit-cadence"
              data-testid="habit-cadence"
              value={cadence}
              onChange={(event) => setCadence(event.target.value as 'daily' | 'weekly')}
              className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            >
              <option value="daily">{t('habits.cadence.daily')}</option>
              <option value="weekly">{t('habits.cadence.weekly')}</option>
            </select>
          </label>
          {cadence === 'weekly' ? (
            <label htmlFor="habit-per-week" className="flex flex-col gap-1">
              <span className="text-xs text-[var(--puls-ink-muted)]">
                {t('habits.form.perWeek')}
              </span>
              <input
                id="habit-per-week"
                data-testid="habit-per-week"
                inputMode="numeric"
                value={perWeek}
                onChange={(event) => setPerWeek(event.target.value)}
                className="h-11 w-20 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
              />
            </label>
          ) : null}
          <button
            type="submit"
            data-testid="habit-create"
            disabled={busy}
            className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-5 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
          >
            {t('habits.form.submit')}
          </button>
        </form>
      </Card>

      <section className="grid gap-4 md:grid-cols-2" data-testid="habits-list">
        {active.map((habit) => (
          <HabitRow key={habit.id} habit={habit} />
        ))}
        {active.length === 0 && !loading ? (
          <div
            className="rounded-[var(--radius-card)] bg-[var(--puls-surface)] shadow-sm md:col-span-2"
            data-testid="habits-empty"
          >
            <EmptyState icon="repeat" tone="wellbeing" title={t('habits.empty')} />
          </div>
        ) : null}
      </section>

      {archived.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2" data-testid="habits-archive-list">
          <h2 className="text-lg font-bold md:col-span-2">{t('habits.archive.title')}</h2>
          <p className="text-sm md:col-span-2 text-[var(--puls-ink-muted)]">
            {t('habits.archive.hint')}
          </p>
          {archived.map((habit) => (
            <HabitRow key={habit.id} habit={habit} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
