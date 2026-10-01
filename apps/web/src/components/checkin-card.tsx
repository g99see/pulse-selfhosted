// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckInDto, Mood, StreakDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Confetti } from '@/components/confetti';
import { HabitsToday } from '@/components/habits-today';
import { MoodScale } from '@/components/mood-scale';
import { Card } from '@/components/ui';
import { recentlyEarnedCodes } from '@/lib/achievements';
import { achievementsApi } from '@/lib/achievements-client';
import { slotForHour } from '@/lib/checkin';
import { CHECKIN_CHANGED_EVENT, checkinApi, notifyCheckInChanged } from '@/lib/checkin-client';

const CELEBRATION_MS = 3000;

/**
 * Карточка чек-ина на главной (ТЗ §3.3, §4, §8): вопрос «Как ты себя
 * чувствуешь?», шкала настроения в одно нажатие, серия чек-инов и конфетти при
 * получении нового достижения.
 */
export function CheckInCard() {
  const { t } = useT();
  const [checkIns, setCheckIns] = useState<CheckInDto[]>([]);
  const [streak, setStreak] = useState<StreakDto | null>(null);
  const [saved, setSaved] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const celebrated = useRef(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const today = await checkinApi.today();
      setCheckIns(today.checkIns);
    } catch {
      setCheckIns([]);
    }

    try {
      setStreak(await achievementsApi.streak());
    } catch {
      // Серия — дополнение к карточке: без неё чек-ин всё равно работает.
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    function onChanged(): void {
      void reload();
    }
    window.addEventListener(CHECKIN_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CHECKIN_CHANGED_EVENT, onChanged);
  }, [reload]);

  async function celebrateIfEarned(): Promise<void> {
    if (celebrated.current) return;
    try {
      const list = await achievementsApi.list();
      setStreak(list.streak);
      if (recentlyEarnedCodes(list.achievements, Date.now()).length > 0) {
        celebrated.current = true;
        setCelebrate(true);
        window.setTimeout(() => setCelebrate(false), CELEBRATION_MS);
      }
    } catch {
      // Не мешаем основному действию.
    }
  }

  async function answer(mood: Mood): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await checkinApi.quick(mood, slotForHour(new Date().getHours()));
      setSaved(true);
      notifyCheckInChanged();
      await reload();
      await celebrateIfEarned();
    } catch {
      setError(t('auth.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  const last = checkIns[0];

  return (
    <Card>
      {celebrate ? <Confetti /> : null}
      <div className="flex flex-col gap-4" data-testid="checkin-card">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">{t('checkin.card.question')}</h2>
          {checkIns.length > 0 ? (
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {t('checkin.card.today', { count: checkIns.length })}
            </span>
          ) : null}
        </div>

        {streak && streak.current > 0 ? (
          <p
            data-testid="checkin-streak"
            className="text-sm font-medium text-[var(--puls-wellbeing-text)]"
          >
            {t('checkin.card.streak', { days: streak.current })}
          </p>
        ) : null}

        <MoodScale
          value={last ? (last.mood as Mood) : null}
          onChange={(mood) => void answer(mood)}
          disabled={busy}
          size="lg"
        />

        {saved ? (
          <p role="status" data-testid="checkin-card-saved" className="text-sm text-[var(--puls-wellbeing-text)]">
            {t('checkin.card.saved')}
          </p>
        ) : (
          <p className="text-sm text-[var(--puls-ink-muted)]">{t('checkin.card.hint')}</p>
        )}

        {error ? (
          <p role="alert" className="text-sm text-[var(--puls-warning-text)]">
            {error}
          </p>
        ) : null}

        <HabitsToday />

        <Link
          href="/checkin"
          data-testid="checkin-open"
          className="text-sm font-medium text-[var(--puls-primary-text)]"
        >
          {t('checkin.card.open')}
        </Link>
      </div>
    </Card>
  );
}
