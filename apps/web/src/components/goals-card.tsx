// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { isGoalImageUrl, type GoalDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { ProgressRing } from '@/components/progress-ring';
import { Card, EmptyState, IconBubble } from '@/components/ui';
import { GOALS_CHANGED_EVENT, goalsApi } from '@/lib/goals-client';

/** Картинка цели: эмодзи-пресет или ссылка http(s). */
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

/** Карточка целей на главной (ТЗ §8): кольца прогресса и переход к «/goals». */
export function GoalsCard() {
  const { t } = useT();
  const [goals, setGoals] = useState<GoalDto[]>([]);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setGoals((await goalsApi.list()).goals);
    } catch {
      // Блок не критичен для главной — при ошибке просто остаётся пустым.
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    function onChanged(): void {
      void reload();
    }
    window.addEventListener(GOALS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(GOALS_CHANGED_EVENT, onChanged);
  }, [reload]);

  const featured = goals.slice(0, 2);

  return (
    <Card className="flex min-h-[160px] flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconBubble name="target" tone="finance" />
          <h2 className="font-heading text-lg font-bold">{t('goals.card.title')}</h2>
        </div>
        <Link href="/goals" className="text-sm font-semibold text-[var(--puls-primary-text)]">
          {t('goals.card.more')}
        </Link>
      </div>

      {featured.length === 0 ? (
        <div data-testid="goals-card-empty">
          <EmptyState
            icon="target"
            tone="finance"
            title={t('goals.card.empty')}
            action={
              <Link
                href="/goals"
                className="text-sm font-semibold text-[var(--puls-finance-text)] underline"
              >
                {t('app.today.goalsCta')}
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="grid gap-3" data-testid="goals-card-list">
          {featured.map((goal) => (
            <li
              key={goal.id}
              className="flex items-center gap-3 rounded-[20px] bg-[var(--puls-finance-soft)] p-3"
            >
              <ProgressRing
                percent={goal.percent}
                size={56}
                stroke={6}
                label={t('goals.card.progress', { percent: goal.percent, title: goal.title })}
              />
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2">
                  <GoalImage image={goal.image} />
                  <span className="truncate font-medium">{goal.title}</span>
                </span>
                <span className="text-xs text-[var(--puls-finance-text)]">
                  {t('goals.card.progress', { percent: goal.percent, title: goal.title })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
