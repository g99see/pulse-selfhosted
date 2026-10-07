// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  achievementByCode,
  type AchievementStatusDto,
  type AchievementsResponse,
  type Locale,
} from '@puls/shared';
import { useT, type TranslateFn } from '@/components/locale-provider';
import { Confetti } from '@/components/confetti';
import { Card, IconBubble, ProgressBar } from '@/components/ui';
import {
  descriptionThreshold,
  groupAchievements,
  levelLabelKey,
  recentlyEarnedCodes,
  streakProgress,
} from '@/lib/achievements';
import { achievementsApi } from '@/lib/achievements-client';
import { CHECKIN_CHANGED_EVENT } from '@/lib/checkin-client';
import { formatDate } from '@/lib/format';

const CELEBRATION_MS = 3000;

/** Подставляет порог уровня в описание вместо плейсхолдера {n}. */
function fillThreshold(text: string, threshold: number): string {
  return text.replace('{n}', String(threshold));
}

/** Пломбы уровней: полученные подсвечены, остальные показаны как закрытые. */
function TierSeals({ item, t }: { item: AchievementStatusDto; t: TranslateFn }) {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-1.5">
      {item.tiers.map((tier) => {
        const earned = tier.earnedAt !== null;
        return (
          <li
            key={`${tier.level}-${tier.threshold}`}
            data-testid={`achievement-tier-${item.code}-${tier.level}`}
            data-tier-earned={earned}
            className={`flex items-center gap-1 rounded-[var(--radius-chip)] px-2 py-0.5 text-[10px] font-semibold ${
              earned
                ? 'bg-[var(--puls-wellbeing-soft)] text-[var(--puls-wellbeing-text)]'
                : 'bg-[var(--puls-surface)] text-[var(--puls-ink-muted)] opacity-70'
            }`}
          >
            <span aria-hidden="true">{earned ? '★' : '☆'}</span>
            <span>
              {t(levelLabelKey(tier.level))} {tier.threshold}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Карточка достижения: иконка, тексты, уровни, прогресс или награда. */
function AchievementCard({
  item,
  t,
  locale,
}: {
  item: AchievementStatusDto;
  t: TranslateFn;
  locale: Locale;
}) {
  const definition = achievementByCode(item.code);
  // Скрытое до получения достижение маскируем — без утечки иконки, текста и прогресса.
  const masked = item.hidden && !item.earned;
  const emoji = masked ? '❔' : (definition?.icon ?? '⭐');
  const title = masked
    ? t('achievements.hidden.title')
    : t(definition?.titleKey ?? 'achievements.title');
  const description = masked
    ? t('achievements.hidden.description')
    : fillThreshold(
        t(definition?.descriptionKey ?? 'achievements.title'),
        descriptionThreshold(item),
      );

  return (
    <li
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
          <span className={`font-semibold ${item.earned ? 'text-[var(--puls-ink)]' : ''}`}>
            {title}
          </span>
          <span className="text-xs text-[var(--puls-ink-muted)]">{description}</span>
        </span>
      </div>

      {masked ? null : <TierSeals item={item} t={t} />}

      {item.earned ? (
        <>
          <p className="text-xs font-semibold text-[var(--puls-wellbeing-text)]">
            {t('achievements.earned')}
            {item.level ? ` · ${t(levelLabelKey(item.level))}` : ''}
            {item.earnedAt
              ? ` · ${formatDate(item.earnedAt, locale, { dateStyle: 'medium' })}`
              : ''}
          </p>
        </>
      ) : masked ? (
        <p className="text-xs text-[var(--puls-ink-muted)]">{t('achievements.locked')}</p>
      ) : item.nextThreshold !== null ? (
        <div className="w-full">
          <ProgressBar
            value={Math.round(item.progress * item.nextThreshold)}
            max={item.nextThreshold}
            label={t('achievements.progress', {
              current: item.value,
              target: item.nextThreshold,
            })}
          />
        </div>
      ) : (
        <p className="text-xs text-[var(--puls-ink-muted)]">{t('achievements.locked')}</p>
      )}
    </li>
  );
}

/** Экран достижений (ТЗ v2 §4): уровни, прогресс и серия чек-инов. */
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
          <h2 className="text-lg font-bold">{t(`achievements.group.${view.group}`)}</h2>
          <ul
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            data-testid={`achievements-group-${view.group}`}
          >
            {view.items.map((item) => (
              <AchievementCard key={item.code} item={item} t={t} locale={locale} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
