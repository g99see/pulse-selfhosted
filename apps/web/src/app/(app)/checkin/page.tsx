// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CHECKIN_TAG_SUGGESTIONS,
  DEFAULT_CHECKIN_SCHEDULE,
  MOOD_COLORS,
  MOOD_EMOJI,
  type CheckInDto,
  type CheckInSlot,
  type Mood,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { MetricScale, MoodScale } from '@/components/mood-scale';
import { formatDate } from '@/lib/format';
import { slotForHour } from '@/lib/checkin';
import { checkinApi, notifyCheckInChanged } from '@/lib/checkin-client';

const SLOT_LABEL_KEYS: Record<CheckInSlot, string> = {
  morning: 'checkin.slot.morning',
  day: 'checkin.slot.day',
  evening: 'checkin.slot.evening',
};

const TIME_SUGGESTIONS = ['09:00', '12:00', '15:00', '18:00', '20:00', '22:00'];

/** Страница чек-инов (ТЗ §3.3, §8): шкала настроения, расширенный чек-ин, итог дня, расписание. */
export default function CheckInPage() {
  const { t, locale } = useT();

  const [mood, setMood] = useState<Mood | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  const [sleepHours, setSleepHours] = useState('');
  const [water, setWater] = useState('');
  const [steps, setSteps] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [daySummary, setDaySummary] = useState('');

  const [history, setHistory] = useState<CheckInDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [timesPerDay, setTimesPerDay] = useState(DEFAULT_CHECKIN_SCHEDULE.timesPerDay);
  const [times, setTimes] = useState<string[]>(DEFAULT_CHECKIN_SCHEDULE.times);
  const [scheduleSaved, setScheduleSaved] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [list, schedule] = await Promise.all([
        checkinApi.list({ limit: 30 }),
        checkinApi.schedule(),
      ]);
      setHistory(list.checkIns);
      setTimesPerDay(schedule.schedule.timesPerDay);
      setTimes(schedule.schedule.times);
      setError(null);
    } catch {
      setError(t('auth.error.generic'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function toggleTag(tag: string): void {
    setTags((previous) =>
      previous.includes(tag) ? previous.filter((item) => item !== tag) : [...previous, tag],
    );
  }

  function changeTimesPerDay(next: number): void {
    const clamped = Math.min(6, Math.max(1, next));
    setTimesPerDay(clamped);
    setTimes((previous) => {
      const copy = [...previous];
      while (copy.length < clamped) {
        const candidate = TIME_SUGGESTIONS.find((item) => !copy.includes(item));
        copy.push(candidate ?? `0${copy.length}:00`);
      }
      return copy.slice(0, clamped);
    });
  }

  function changeTime(index: number, value: string): void {
    setTimes((previous) => previous.map((item, position) => (position === index ? value : item)));
  }

  function numberOrUndefined(value: string): number | undefined {
    const parsed = Number(value.replace(',', '.'));
    return value.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined;
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!mood) {
      setError(t('checkin.noMood'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await checkinApi.create({
        mood,
        energy: energy ?? undefined,
        stress: stress ?? undefined,
        sleepHours: numberOrUndefined(sleepHours),
        water: numberOrUndefined(water),
        steps: numberOrUndefined(steps),
        tags,
        note: note.trim() || undefined,
        daySummary: daySummary.trim() || undefined,
        slot: slotForHour(new Date().getHours()),
      });
      setSaved(true);
      notifyCheckInChanged();
      setMood(null);
      setEnergy(null);
      setStress(null);
      setSleepHours('');
      setWater('');
      setSteps('');
      setTags([]);
      setNote('');
      setDaySummary('');
      await reload();
    } catch {
      setError(t('auth.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedule(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await checkinApi.saveSchedule({ timesPerDay, times });
      setScheduleSaved(true);
    } catch {
      setError(t('auth.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="checkin-page">
      <h1 className="text-3xl font-extrabold">{t('checkin.title')}</h1>

      {error ? (
        <p role="alert" className="text-sm text-[var(--puls-warning)]">
          {error}
        </p>
      ) : null}

      <form
        className="flex flex-col gap-5 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm"
        onSubmit={(event) => void submit(event)}
      >
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">{t('checkin.card.question')}</h2>
          <MoodScale value={mood} onChange={setMood} disabled={busy} size="lg" />
        </div>

        <details className="flex flex-col gap-3" open>
          <summary className="cursor-pointer text-sm font-medium">{t('checkin.extended')}</summary>
          <div className="mt-3 flex flex-col gap-4">
            <MetricScale
              value={energy}
              onChange={setEnergy}
              testId="checkin-energy"
              labels={{ legend: t('checkin.energy'), option: (value) => t('checkin.scale.option', { value }) }}
              disabled={busy}
            />
            <MetricScale
              value={stress}
              onChange={setStress}
              testId="checkin-stress"
              labels={{ legend: t('checkin.stress'), option: (value) => t('checkin.scale.option', { value }) }}
              disabled={busy}
            />

            <div className="flex flex-wrap gap-3">
              <label htmlFor="checkin-sleep" className="flex flex-1 flex-col gap-1">
                <span className="text-sm font-medium">{t('checkin.sleep')}</span>
                <input
                  id="checkin-sleep"
                  data-testid="checkin-sleep"
                  inputMode="decimal"
                  value={sleepHours}
                  onChange={(event) => setSleepHours(event.target.value)}
                  className="h-11 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-3"
                />
              </label>
              <label htmlFor="checkin-water" className="flex flex-1 flex-col gap-1">
                <span className="text-sm font-medium">{t('checkin.water')}</span>
                <input
                  id="checkin-water"
                  data-testid="checkin-water"
                  inputMode="numeric"
                  value={water}
                  onChange={(event) => setWater(event.target.value)}
                  className="h-11 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-3"
                />
              </label>
              <label htmlFor="checkin-steps" className="flex flex-1 flex-col gap-1">
                <span className="text-sm font-medium">{t('checkin.steps')}</span>
                <input
                  id="checkin-steps"
                  data-testid="checkin-steps"
                  inputMode="numeric"
                  value={steps}
                  onChange={(event) => setSteps(event.target.value)}
                  className="h-11 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-3"
                />
              </label>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{t('checkin.tags')}</legend>
              <div className="flex flex-wrap gap-2">
                {CHECKIN_TAG_SUGGESTIONS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={tags.includes(tag)}
                    onClick={() => toggleTag(tag)}
                    className="rounded-[var(--radius-chip)] border px-3 py-1.5 text-sm"
                    style={{
                      borderColor: tags.includes(tag) ? 'var(--puls-wellbeing)' : 'var(--puls-ink-muted)',
                      backgroundColor: tags.includes(tag) ? 'var(--puls-wellbeing)' : 'transparent',
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </fieldset>

            <label htmlFor="checkin-note" className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t('checkin.note')}</span>
              <textarea
                id="checkin-note"
                data-testid="checkin-note"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-3 py-2"
              />
            </label>

            <label htmlFor="checkin-day-summary" className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t('checkin.daySummary')}</span>
              <input
                id="checkin-day-summary"
                data-testid="checkin-day-summary"
                value={daySummary}
                onChange={(event) => setDaySummary(event.target.value)}
                placeholder={t('checkin.daySummaryPlaceholder')}
                className="h-11 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-3"
              />
            </label>
          </div>
        </details>

        <button
          type="submit"
          data-testid="checkin-save"
          disabled={busy}
          className="h-12 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
        >
          {t('checkin.save')}
        </button>

        {saved ? (
          <p role="status" data-testid="checkin-saved" className="text-sm text-[var(--puls-wellbeing-text)]">
            {t('checkin.saved')}
          </p>
        ) : null}
      </form>

      <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
        <h2 className="text-lg font-bold">{t('checkin.history')}</h2>
        <ul className="flex flex-col divide-y divide-[var(--puls-ink-muted)]/15" data-testid="checkin-history">
          {history.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-3">
              <span className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg"
                  style={{ backgroundColor: MOOD_COLORS[item.mood as Mood] }}
                >
                  {MOOD_EMOJI[item.mood as Mood]}
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-medium">
                    {item.slot ? t(SLOT_LABEL_KEYS[item.slot]) : t('checkin.slot.day')}
                  </span>
                  <span className="text-xs text-[var(--puls-ink-muted)]">
                    {formatDate(item.occurredAt, locale, {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {item.sleepHours !== null ? ` · ${t('checkin.historySleep', { hours: item.sleepHours })}` : ''}
                  </span>
                  {item.daySummary ? (
                    <span className="text-sm" data-testid="checkin-history-summary">
                      {item.daySummary}
                    </span>
                  ) : null}
                </span>
              </span>
            </li>
          ))}
          {history.length === 0 && !loading ? (
            <li className="py-3 text-sm text-[var(--puls-ink-muted)]">{t('checkin.history.empty')}</li>
          ) : null}
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
        <h2 className="text-lg font-bold">{t('checkin.schedule')}</h2>
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('checkin.schedule.hint')}</p>

        <label htmlFor="checkin-times-per-day" className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('checkin.schedule.timesPerDay')}</span>
          <select
            id="checkin-times-per-day"
            data-testid="checkin-times-per-day"
            value={timesPerDay}
            onChange={(event) => changeTimesPerDay(Number(event.target.value))}
            className="h-11 w-24 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-3"
          >
            {[1, 2, 3, 4, 5, 6].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-2">
          {times.map((time, index) => (
            <label key={`${time}-${index}`} className="flex flex-col gap-1">
              <span className="text-xs text-[var(--puls-ink-muted)]">{index + 1}</span>
              <input
                type="time"
                data-testid={`checkin-time-${index}`}
                value={time}
                onChange={(event) => changeTime(index, event.target.value)}
                className="h-11 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-3"
              />
            </label>
          ))}
        </div>

        <button
          type="button"
          data-testid="checkin-schedule-save"
          disabled={busy}
          onClick={() => void saveSchedule()}
          className="h-11 w-fit rounded-[var(--radius-button)] border border-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-primary-text)] disabled:opacity-50"
        >
          {t('checkin.schedule.save')}
        </button>

        {scheduleSaved ? (
          <p role="status" data-testid="checkin-schedule-saved" className="text-sm text-[var(--puls-wellbeing-text)]">
            {t('checkin.schedule.saved')}
          </p>
        ) : null}
      </section>
    </div>
  );
}
