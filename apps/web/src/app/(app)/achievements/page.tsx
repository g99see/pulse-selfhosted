// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { achievementByCode, type AchievementCode, type AchievementsResponse } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Confetti } from '@/components/confetti';
import { Card, IconBubble, ProgressBar } from '@/components/ui';
import { ShareButton } from '@/components/share-button';
import { groupAchievements, recentlyEarnedCodes, streakProgress } from '@/lib/achievements';
import { achievementsApi } from '@/lib/achievements-client';
import { CHECKIN_CHANGED_EVENT } from '@/lib/checkin-client';
import { formatDate } from '@/lib/format';

/** Пиктограмма бейджа (ТЗ §8): эмодзи по коду. */
const BADGE_EMOJI: Record<AchievementCode, string> = {
  first_checkin: '🌱',
  checkin_streak_7: '🔥',
  checkin_streak_30: '🏅',
  checkin_streak_100: '💯',
  first_transaction: '🧾',
  first_budget_closed: '📊',
  first_goal: '🎯',
  goal_half: '⛰️',
  goal_complete: '🏆',
};

const GROUP_LABEL_KEYS: Record<string, string> = {
  checkins: 'achievements.group.checkins',
  finance: 'achievements.group.finance',
  goals: 'achievements.group.goals',
};

const CELEBRATION_MS = 3000;

/** Экран достижений (ТЗ §4, §8): сетка бейджей, стрик и прогресс до награды. */
export default function AchievementsPage() {
  const { t, locale } = useT();
  const [data, setData] = useState<AchievementsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const celebrated = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await achievementsApi.list();
      setData(response);
      setError(null);

      if (!celebrated.current) {
        const fresh = recentlyEarnedCodes(response.achievements, Date.now());
        if (fresh.length > 0) {
          celebrated.current = true;
          setCelebrate(true);
          window.setTimeout(() => setCelebrate(false), CELEBRATION_MS);
        }
      }
    } catch {
      setError(t('achievements.error'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onChanged(): void {
      void load();
    }
    window.addEventListener(CHECKIN_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CHECKIN_CHANGED_EVENT, onChanged);
  }, [load]);

  const groups = useMemo(() => (data ? groupAchievements(data.achievements) : []), [data]);

  if (!data) {
    return (
      <div className="flex flex-col gap-4" data-testid="achievements-page">
        <h1 className="text-2xl font-extrabold">{t('achievements.title')}</h1>
        {error ? (
          <p role="alert" className="text-sm text-[var(--puls-warning-text)]">
            {error}
          </p>
        ) : (
          <p className="text-sm text-[var(--puls-ink-muted)]">{t('common.loading')}</p>
        )}
      </div>
    );
  }

  const { streak } = data;

  return (
    <div className="flex flex-col gap-5" data-testid="achievements-page">
      {celebrate ? <Confetti /> : null}

      <div className="flex items-center gap-3">
        <IconBubble name="trophy" tone="wellbeing" size={44} />
        <div>
          <h1 className="text-2xl font-extrabold">{t('achievements.title')}</h1>
          <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('achievements.subtitle')}</p>
        </div>
      </div>

      <Card>
        <div className="flex flex-col gap-3" data-testid="achievements-streak">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">{t('achievements.streak.title')}</h2>
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {streak.checkedToday
                ? t('achievements.streak.todayDone')
                : t('achievements.streak.todayPending')}
            </span>
          </div>

          {streak.current > 0 ? (
            <p className="w-fit rounded-[var(--radius-chip)] bg-[var(--puls-wellbeing-soft)] px-4 py-1.5 text-2xl font-extrabold text-[var(--puls-wellbeing-text)]">
              {streak.current === 1
                ? t('achievements.streak.one')
                : t('achievements.streak.current', { days: streak.current })}
            </p>
          ) : (
            <p className="text-sm text-[var(--puls-ink-muted)]">{t('achievements.streak.none')}</p>
          )}

          <p className="text-xs text-[var(--puls-ink-muted)]">
            {t('achievements.streak.longest', { days: streak.longest })}
          </p>

          <ShareButton
            type="checkin_streak"
            shareText={t('share.text.streak', { days: streak.current })}
          />

          {streak.nextMilestone ? (
            <ProgressBar
              value={Math.round(streakProgress(streak) * streak.nextMilestone.threshold)}
              max={streak.nextMilestone.threshold}
              label={t('achievements.streak.next', {
                title: t(
                  achievementByCode(streak.nextMilestone.code)?.titleKey ?? 'achievements.title',
                ),
                days: Math.max(
                  0,
                  streak.nextMilestone.threshold - Math.max(streak.current, streak.longest),
                ),
              })}
            />
          ) : null}
        </div>
      </Card>

      {groups.map((view) => (
        <section key={view.group} className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">
            {t(GROUP_LABEL_KEYS[view.group] ?? 'achievements.title')}
          </h2>
          <ul
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            data-testid={`achievements-group-${view.group}`}
          >
            {view.items.map((item) => {
              const definition = achievementByCode(item.code);
              const emoji = BADGE_EMOJI[item.code] ?? '⭐';
              return (
                <li
                  key={item.code}
                  data-testid={`achievement-${item.code}`}
                  data-earned={item.earned}
                  className={`flex flex-col items-center gap-3 rounded-[var(--radius-card)] p-5 text-center ${
                    item.earned
                      ? 'bg-[var(--puls-wellbeing-soft)] shadow-sm'
                      : 'bg-[var(--puls-surface-2)] text-[var(--puls-ink-muted)]'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`flex h-16 w-16 items-center justify-center rounded-full text-3xl ${
                        item.earned
                          ? 'bg-[var(--puls-surface)] shadow-sm'
                          : 'bg-[var(--puls-line)] opacity-60 grayscale'
                      }`}
                    >
                      {emoji}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span
                        className={`font-semibold ${item.earned ? 'text-[var(--puls-ink)]' : ''}`}
                      >
                        {t(definition?.titleKey ?? 'achievements.title')}
                      </span>
                      <span className="text-xs text-[var(--puls-ink-muted)]">
                        {t(definition?.descriptionKey ?? 'achievements.title')}
                      </span>
                    </span>
                  </div>

                  {item.earned ? (
                    <>
                      <p className="text-xs font-semibold text-[var(--puls-wellbeing-text)]">
                        {t('achievements.earned')}
                        {item.earnedAt
                          ? ` · ${formatDate(item.earnedAt, locale, { dateStyle: 'medium' })}`
                          : ''}
                      </p>
                      <ShareButton
                        type="achievement"
                        id={item.code}
                        shareText={t('share.text.achievement', {
                          title: t(definition?.titleKey ?? 'achievements.title'),
                        })}
                      />
                    </>
                  ) : definition?.threshold &&
                    definition.group === 'checkins' &&
                    item.progress > 0 ? (
                    <div className="w-full">
                      <ProgressBar
                        value={Math.round(item.progress * definition.threshold)}
                        max={definition.threshold}
                        label={t('achievements.progress', {
                          current: Math.round(item.progress * definition.threshold),
                          target: definition.threshold,
                        })}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--puls-ink-muted)]">
                      {t('achievements.locked')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
