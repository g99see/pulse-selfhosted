// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { HabitTodayItemDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { HABITS_CHANGED_EVENT, habitsApi, notifyHabitsChanged } from '@/lib/habits-client';

/**
 * Блок «Привычки сегодня» (ТЗ §4, P2): чекбоксы отметок на странице чек-ина и
 * в карточке чек-ина на главной. Пустой список не показываем.
 */
export function HabitsToday({ showEmpty = false }: { showEmpty?: boolean }) {
  const { t } = useT();
  const [items, setItems] = useState<HabitTodayItemDto[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const response = await habitsApi.today();
      setItems(response.habits);
    } catch {
      setItems([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    function onChanged(): void {
      void reload();
    }
    window.addEventListener(HABITS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(HABITS_CHANGED_EVENT, onChanged);
  }, [reload]);

  async function toggle(item: HabitTodayItemDto): Promise<void> {
    setBusy(item.id);
    try {
      await habitsApi.mark(item.id, { done: !item.done });
      notifyHabitsChanged();
      await reload();
    } catch {
      // Отметка — дополнение к чек-ину: без неё основное действие работает.
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    if (!showEmpty) return null;
    // Заглушка той же высоты, что и пустое состояние: блок не сдвигает соседей при загрузке.
    if (!loaded) {
      return (
        <div
          aria-hidden="true"
          className="h-[46px] animate-pulse rounded-[20px] bg-[var(--puls-surface)]/60"
        />
      );
    }
    return (
      <div
        data-testid="habits-today-empty"
        className="flex flex-wrap items-center justify-between gap-2 rounded-[20px] bg-[var(--puls-surface)] px-4 py-3 text-sm"
      >
        <span className="text-[var(--puls-ink-muted)]">{t('habits.empty')}</span>
        <Link href="/habits" className="font-semibold text-[var(--puls-primary-text)]">
          {t('app.today.habitsCta')}
        </Link>
      </div>
    );
  }

  return (
    <section
      className="flex flex-col gap-2 rounded-[20px] bg-[var(--puls-surface)] p-4"
      data-testid="habits-today"
    >
      <h3 className="text-sm font-semibold">{t('habits.today.title')}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id} data-testid="habit-today-item" className="flex items-center gap-3">
            <label className="flex flex-1 items-center gap-2">
              <input
                type="checkbox"
                data-testid="habit-today-checkbox"
                checked={item.done}
                disabled={busy === item.id}
                onChange={() => void toggle(item)}
                className="h-5 w-5 accent-[var(--puls-primary)]"
              />
              <span aria-hidden="true" className="text-lg leading-none">
                {item.icon}
              </span>
              <span className="text-sm font-medium">{item.name}</span>
            </label>
            {item.streak > 0 ? (
              <span
                data-testid="habit-today-streak"
                className="text-xs text-[var(--puls-ink-muted)]"
              >
                {t('habits.streak', { days: item.streak })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
