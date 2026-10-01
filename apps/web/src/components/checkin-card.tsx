// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { CheckInDto, Mood } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { MoodScale } from '@/components/mood-scale';
import { Card } from '@/components/ui';
import { slotForHour } from '@/lib/checkin';
import { CHECKIN_CHANGED_EVENT, checkinApi, notifyCheckInChanged } from '@/lib/checkin-client';

/**
 * Карточка чек-ина на главной (ТЗ §3.3, §8): вопрос «Как ты себя чувствуешь?»
 * и шкала настроения — ответ в одно нажатие.
 */
export function CheckInCard() {
  const { t } = useT();
  const [checkIns, setCheckIns] = useState<CheckInDto[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const today = await checkinApi.today();
      setCheckIns(today.checkIns);
    } catch {
      setCheckIns([]);
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

  async function answer(mood: Mood): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await checkinApi.quick(mood, slotForHour(new Date().getHours()));
      setSaved(true);
      notifyCheckInChanged();
      await reload();
    } catch {
      setError(t('auth.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  const last = checkIns[0];

  return (
    <Card>
      <div className="flex flex-col gap-4" data-testid="checkin-card">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">{t('checkin.card.question')}</h2>
          {checkIns.length > 0 ? (
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {t('checkin.card.today', { count: checkIns.length })}
            </span>
          ) : null}
        </div>

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
          <p role="alert" className="text-sm text-[var(--puls-warning)]">
            {error}
          </p>
        ) : null}

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
