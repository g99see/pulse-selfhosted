// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import { HABIT_ICON_PRESETS, type HabitStatsItemDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
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
    if (typeof window !== 'undefined' && !window.confirm(t('habits.deleteConfirm', { name: habit.name }))) {
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
        className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm"
      >
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="text-2xl leading-none">
            {habit.icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-lg font-bold">{habit.name}</span>
          <button
            type="button"
            data-testid="habit-delete"
            onClick={() => void removeHabit(habit)}
            disabled={busy}
            className="text-xs text-[var(--puls-ink-muted)] disabled:opacity-50"
          >
            {t('habits.delete')}
          </button>
        </div>
        <span className="text-xs text-[var(--puls-ink-muted)]">
          {habit.cadence === 'weekly'
            ? t('habits.cadence.weeklyTarget', { count: habit.perWeek })
            : t('habits.cadence.daily')}
        </span>
        <span className="flex flex-wrap gap-2 text-xs">
          <span data-testid="habit-streak" className="font-medium text-[var(--puls-wellbeing-text)]">
            {habit.streak > 0 ? t('habits.streak', { days: habit.streak }) : t('habits.streak.none')}
          </span>
          <span data-testid="habit-rate7" className="text-[var(--puls-ink-muted)]">
            {t('habits.rate7', { percent: habit.rate7 })}
          </span>
          <span data-testid="habit-rate30" className="text-[var(--puls-ink-muted)]">
            {t('habits.rate30', { percent: habit.rate30 })}
          </span>
        </span>
        <button
          type="button"
          data-testid={habit.archived ? 'habit-restore' : 'habit-archive'}
          onClick={() => void setArchived(habit, !habit.archived)}
          disabled={busy}
          className="w-fit rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {habit.archived ? t('habits.restore') : t('habits.archive')}
        </button>
      </article>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-3xl font-extrabold">{t('habits.title')}</h1>

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

      <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
        <h2 className="text-lg font-bold">{t('habits.add')}</h2>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void addHabit(event)}>
          <label htmlFor="habit-name" className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('habits.form.name')}</span>
            <input
              id="habit-name"
              data-testid="habit-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            />
          </label>
          <label htmlFor="habit-icon" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('habits.form.icon')}</span>
            <select
              id="habit-icon"
              data-testid="habit-icon"
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
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
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            >
              <option value="daily">{t('habits.cadence.daily')}</option>
              <option value="weekly">{t('habits.cadence.weekly')}</option>
            </select>
          </label>
          {cadence === 'weekly' ? (
            <label htmlFor="habit-per-week" className="flex flex-col gap-1">
              <span className="text-xs text-[var(--puls-ink-muted)]">{t('habits.form.perWeek')}</span>
              <input
                id="habit-per-week"
                data-testid="habit-per-week"
                inputMode="numeric"
                value={perWeek}
                onChange={(event) => setPerWeek(event.target.value)}
                className="h-10 w-20 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
              />
            </label>
          ) : null}
          <button
            type="submit"
            data-testid="habit-create"
            disabled={busy}
            className="h-10 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
          >
            {t('habits.form.submit')}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-4" data-testid="habits-list">
        {active.map((habit) => (
          <HabitRow key={habit.id} habit={habit} />
        ))}
        {active.length === 0 && !loading ? (
          <p className="text-sm text-[var(--puls-ink-muted)]" data-testid="habits-empty">
            {t('habits.empty')}
          </p>
        ) : null}
      </section>

      {archived.length > 0 ? (
        <section className="flex flex-col gap-4" data-testid="habits-archive-list">
          <h2 className="text-lg font-bold">{t('habits.archive.title')}</h2>
          <p className="text-sm text-[var(--puls-ink-muted)]">{t('habits.archive.hint')}</p>
          {archived.map((habit) => (
            <HabitRow key={habit.id} habit={habit} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
