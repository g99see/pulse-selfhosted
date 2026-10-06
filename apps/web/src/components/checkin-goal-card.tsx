// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import { CHECKIN_GOAL_MAX, CHECKIN_GOAL_MIN, type CheckinGoalDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { GhostButton } from '@/components/ui';
import { CHECKIN_CHANGED_EVENT } from '@/lib/checkin-client';
import { checkinGoalApi } from '@/lib/v2-client';

/** Цель «N чек-инов в неделю» с прогрессом текущей недели (ТЗ v2 §7). */
export function CheckinGoalCard() {
  const { t } = useT();
  const [goal, setGoal] = useState<CheckinGoalDto | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const loaded = await checkinGoalApi.get();
      setGoal(loaded);
      setValue(loaded.perWeek === null ? '' : String(loaded.perWeek));
    } catch {
      // Блок не критичен.
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener(CHECKIN_CHANGED_EVENT, load);
    return () => window.removeEventListener(CHECKIN_CHANGED_EVENT, load);
  }, [load]);

  async function save(perWeek: number | null): Promise<void> {
    setError(false);
    try {
      const saved = await checkinGoalApi.set(perWeek);
      setGoal(saved);
      setValue(saved.perWeek === null ? '' : String(saved.perWeek));
    } catch {
      setError(true);
    }
  }

  if (!goal) return null;
  const parsed = Number(value);
  const valid =
    Number.isInteger(parsed) && parsed >= CHECKIN_GOAL_MIN && parsed <= CHECKIN_GOAL_MAX;

  return (
    <div data-testid="checkin-goal" className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">{t('checkin.goal.title')}</h2>
      {goal.perWeek !== null ? (
        <>
          <div
            role="progressbar"
            aria-valuenow={goal.percent ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('checkin.goal.title')}
            className="h-3 w-full overflow-hidden rounded-full bg-[var(--puls-surface-2)]"
          >
            <div
              className="h-full rounded-full bg-[var(--puls-wellbeing)]"
              style={{ width: `${goal.percent ?? 0}%` }}
            />
          </div>
          <p className="text-sm text-[var(--puls-ink-muted)]" data-testid="checkin-goal-progress">
            {goal.reached
              ? t('checkin.goal.reached', { count: goal.count, goal: goal.perWeek })
              : t('checkin.goal.progress', { count: goal.count, goal: goal.perWeek })}
          </p>
        </>
      ) : (
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('checkin.goal.none')}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={CHECKIN_GOAL_MIN}
          max={CHECKIN_GOAL_MAX}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label={t('checkin.goal.perWeek')}
          data-testid="checkin-goal-input"
          className="h-11 w-24 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
        />
        <GhostButton
          type="button"
          disabled={!valid}
          onClick={() => void save(parsed)}
          data-testid="checkin-goal-save"
        >
          {t('checkin.goal.save')}
        </GhostButton>
        {goal.perWeek !== null ? (
          <GhostButton type="button" onClick={() => void save(null)}>
            {t('checkin.goal.clear')}
          </GhostButton>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-[var(--puls-warning-text)]">
          {t('checkin.goal.error')}
        </p>
      ) : null}
    </div>
  );
}
