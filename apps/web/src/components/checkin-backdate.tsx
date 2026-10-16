// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useEffect, useState } from 'react';
import { CHECKIN_BACKDATE_HOURS } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { authApi } from '@/lib/auth-client';
import { localeToBcp47 } from '@/lib/locale';
import { isoToZonedWallClock, zonedWallClockToIso } from '@/lib/timezone';

const HOUR_MS = 60 * 60 * 1000;
/** Поправка на расхождение часов с сервером: он сам допускает минуту вперёд. */
const FUTURE_TOLERANCE_MS = 60 * 1000;

/**
 * Заполнение чек-ина задним числом (ТЗ §3.3, QA-2 D4): окно — последние 24 часа.
 *
 * Момент (`occurredAt`) вводится в поясе профиля: он же решает, утро сейчас или
 * вечер и какие данные принимает сервер. Пояс браузера может отличаться
 * (QA-2 D1), поэтому переводим настенные часы в абсолютное время явно.
 */
export function CheckinBackdateField({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  disabled?: boolean;
}) {
  const { t, locale } = useT();
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  // Пояс профиля: запрашиваем один раз, до ответа пользуемся поясом браузера.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let profileTimeZone: string | null = null;
      try {
        const me = await authApi.me();
        profileTimeZone = me.user.timezone || null;
      } catch {
        // Профиль недоступен — работаем в поясе браузера.
      }
      if (cancelled) return;
      setTimeZone(profileTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const timezone = timeZone ?? 'UTC';
  const windowStart = now - CHECKIN_BACKDATE_HOURS * HOUR_MS;
  const min = isoToZonedWallClock(new Date(windowStart).toISOString(), timezone);
  const max = isoToZonedWallClock(new Date(now).toISOString(), timezone);
  const inputValue = value ? isoToZonedWallClock(value, timezone) : '';
  const nowLabel = new Intl.DateTimeFormat(localeToBcp47(locale), {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(now));

  function handleChange(next: string): void {
    setError(null);
    if (next === '') {
      onChange(null);
      return;
    }

    const iso = zonedWallClockToIso(next, timezone);
    if (!iso) {
      setError(t('checkin.backdate.invalid'));
      return;
    }

    const moment = new Date(iso).getTime();
    if (moment < windowStart || moment > now + FUTURE_TOLERANCE_MS) {
      setError(t('checkin.backdate.invalid'));
      return;
    }

    onChange(iso);
  }

  // Границы окна подтягиваем при входе в поле: вкладку могли открыть надолго.
  function refreshNow(): void {
    setNow(Date.now());
  }

  return (
    <div className="flex flex-col gap-2" data-testid="checkin-backdate">
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor="checkin-occurred-at" className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('checkin.backdate.label')}</span>
          <input
            id="checkin-occurred-at"
            data-testid="checkin-occurred-at"
            type="datetime-local"
            value={inputValue}
            min={min}
            max={max}
            disabled={disabled}
            aria-describedby="checkin-backdate-hint"
            onFocus={refreshNow}
            onChange={(event) => handleChange(event.target.value)}
            className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
          />
        </label>

        {value ? (
          <button
            type="button"
            data-testid="checkin-occurred-at-reset"
            disabled={disabled}
            onClick={() => {
              setError(null);
              onChange(null);
            }}
            className="h-11 w-fit rounded-[var(--radius-button)] bg-[var(--puls-primary-soft)] px-4 text-sm font-semibold text-[var(--puls-primary-text)] disabled:opacity-50"
          >
            {t('checkin.backdate.now')}
          </button>
        ) : null}
      </div>

      <p id="checkin-backdate-hint" className="text-sm text-[var(--puls-ink-muted)]">
        {t('checkin.backdate.hint', { tz: timezone, now: nowLabel })}
      </p>

      {error ? (
        <p
          role="alert"
          data-testid="checkin-backdate-error"
          className="text-sm text-[var(--puls-warning-text)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
