// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CHECKIN_TAG_SUGGESTIONS,
  DEFAULT_CHECKIN_SCHEDULE,
  MOOD_COLORS,
  MOOD_EMOJI,
  extractVoiceTags,
  type CheckInDto,
  type CheckInSlot,
  type Mood,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { CheckinGoalCard } from '@/components/checkin-goal-card';
import { HabitsToday } from '@/components/habits-today';
import { MetricScale, MoodScale } from '@/components/mood-scale';
import { VoiceInputButton } from '@/components/voice-input-button';
import { Badge, Card, EmptyState, IconBubble } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { slotForHour } from '@/lib/checkin';
import { checkinApi, notifyCheckInChanged } from '@/lib/checkin-client';

const SLOT_LABEL_KEYS: Record<CheckInSlot, string> = {
  morning: 'checkin.slot.morning',
  day: 'checkin.slot.day',
  evening: 'checkin.slot.evening',
};

const HISTORY_PAGE = 10;

const TAG_CLASS =
  'rounded-[var(--radius-chip)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3 py-1.5 text-sm transition-colors aria-pressed:border-[var(--puls-wellbeing)] aria-pressed:bg-[var(--puls-wellbeing-soft)] aria-pressed:font-semibold aria-pressed:text-[var(--puls-wellbeing-text)]';

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
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [daySummary, setDaySummary] = useState('');

  const [history, setHistory] = useState<CheckInDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE);

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

  /**
   * Подпись тега на языке интерфейса. Хранятся канонические значения
   * (CHECKIN_TAG_SUGGESTIONS, на них опираются рекомендации), переводится только
   * отображение; свои теги пользователя показываются как есть.
   */
  function tagLabel(tag: string): string {
    const key = `checkin.tag.${tag}`;
    const label = t(key);
    return label === key ? tag : label;
  }

  function toggleTag(tag: string): void {
    setTags((previous) =>
      previous.includes(tag) ? previous.filter((item) => item !== tag) : [...previous, tag],
    );
  }

  /** Распознанный текст уходит в заметку или итог дня, найденные теги — в подсказки. */
  function handleVoice(text: string, target: 'note' | 'daySummary'): void {
    const clean = text.trim();
    if (clean.length === 0) return;
    if (target === 'note') {
      setNote((previous) => (previous.trim() ? `${previous.trim()} ${clean}` : clean));
    } else {
      setDaySummary((previous) => (previous.trim() ? `${previous.trim()} ${clean}` : clean));
    }
    const found = extractVoiceTags(clean);
    if (found.length > 0) {
      setSuggestedTags((previous) => Array.from(new Set([...previous, ...found])));
    }
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
      setSuggestedTags([]);
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
      <div className="flex items-center gap-3">
        <IconBubble name="heart" tone="wellbeing" size={44} />
        <h1 className="text-2xl font-extrabold">{t('checkin.title')}</h1>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--puls-warning-text)]">
          {error}
        </p>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form
          className="flex min-w-0 flex-col gap-5 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm sm:p-6"
          onSubmit={(event) => void submit(event)}
        >
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">{t('checkin.card.question')}</h2>
            <MoodScale value={mood} onChange={setMood} disabled={busy} size="lg" />
          </div>

          <details className="flex flex-col gap-3" open>
            <summary className="cursor-pointer text-sm font-medium">
              {t('checkin.extended')}
            </summary>
            <div className="mt-3 flex flex-col gap-4">
              <MetricScale
                value={energy}
                onChange={setEnergy}
                testId="checkin-energy"
                labels={{
                  legend: t('checkin.energy'),
                  option: (value) => t('checkin.scale.option', { value }),
                }}
                disabled={busy}
              />
              <MetricScale
                value={stress}
                onChange={setStress}
                testId="checkin-stress"
                labels={{
                  legend: t('checkin.stress'),
                  option: (value) => t('checkin.scale.option', { value }),
                }}
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
                    className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
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
                    className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
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
                    className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
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
                      className={TAG_CLASS}
                    >
                      {tagLabel(tag)}
                    </button>
                  ))}
                </div>
              </fieldset>

              {suggestedTags.length > 0 ? (
                <fieldset className="flex flex-col gap-2" data-testid="checkin-voice-tags">
                  <legend className="text-sm font-medium">{t('checkin.voice.suggested')}</legend>
                  <div className="flex flex-wrap gap-2">
                    {suggestedTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        data-testid="checkin-voice-tag"
                        aria-pressed={tags.includes(tag)}
                        onClick={() => toggleTag(tag)}
                        className={TAG_CLASS}
                      >
                        {tagLabel(tag)}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="checkin-note" className="text-sm font-medium">
                    {t('checkin.note')}
                  </label>
                  <VoiceInputButton
                    testId="checkin-note-voice"
                    label={t('checkin.voice.dictateNote')}
                    onTranscript={(text) => handleVoice(text, 'note')}
                  />
                </div>
                <textarea
                  id="checkin-note"
                  data-testid="checkin-note"
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className="rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3 py-2"
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="checkin-day-summary" className="text-sm font-medium">
                    {t('checkin.daySummary')}
                  </label>
                  <VoiceInputButton
                    testId="checkin-day-summary-voice"
                    label={t('checkin.voice.dictateSummary')}
                    onTranscript={(text) => handleVoice(text, 'daySummary')}
                  />
                </div>
                <input
                  id="checkin-day-summary"
                  data-testid="checkin-day-summary"
                  value={daySummary}
                  onChange={(event) => setDaySummary(event.target.value)}
                  placeholder={t('checkin.daySummaryPlaceholder')}
                  className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                />
              </div>
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
            <p
              role="status"
              data-testid="checkin-saved"
              className="text-sm text-[var(--puls-wellbeing-text)]"
            >
              {t('checkin.saved')}
            </p>
          ) : null}
        </form>

        <aside className="flex flex-col gap-5">
          <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
            <CheckinGoalCard />
          </section>

          <section
            className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm empty:hidden"
            data-testid="checkin-habits"
          >
            <HabitsToday />
          </section>

          <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <IconBubble name="calendar" tone="primary" size={36} />
              <h2 className="text-lg font-bold">{t('checkin.schedule')}</h2>
            </div>
            <p className="text-sm text-[var(--puls-ink-muted)]">{t('checkin.schedule.hint')}</p>

            <label htmlFor="checkin-times-per-day" className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t('checkin.schedule.timesPerDay')}</span>
              <select
                id="checkin-times-per-day"
                data-testid="checkin-times-per-day"
                value={timesPerDay}
                onChange={(event) => changeTimesPerDay(Number(event.target.value))}
                className="h-11 w-28 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
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
                    className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                  />
                </label>
              ))}
            </div>

            <button
              type="button"
              data-testid="checkin-schedule-save"
              disabled={busy}
              onClick={() => void saveSchedule()}
              className="h-11 w-fit rounded-[var(--radius-button)] bg-[var(--puls-primary-soft)] px-4 text-sm font-semibold text-[var(--puls-primary-text)] disabled:opacity-50"
            >
              {t('checkin.schedule.save')}
            </button>

            {scheduleSaved ? (
              <p
                role="status"
                data-testid="checkin-schedule-saved"
                className="text-sm text-[var(--puls-wellbeing-text)]"
              >
                {t('checkin.schedule.saved')}
              </p>
            ) : null}
          </section>
        </aside>
      </div>

      <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-bold">{t('checkin.history')}</h2>
        <ul className="flex flex-col gap-2" data-testid="checkin-history">
          {history.slice(0, visibleCount).map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-[18px] bg-[var(--puls-surface-2)] px-3 py-2.5"
            >
              <span
                aria-hidden="true"
                className="flex h-11 w-10 shrink-0 items-center justify-center rounded-full text-xl"
                style={{ backgroundColor: MOOD_COLORS[item.mood as Mood] }}
              >
                {MOOD_EMOJI[item.mood as Mood]}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex flex-wrap items-center gap-x-2 text-sm">
                  <span className="font-semibold">
                    {item.slot ? t(SLOT_LABEL_KEYS[item.slot]) : t('checkin.slot.day')}
                  </span>
                  <span className="text-xs text-[var(--puls-ink-muted)]">
                    {formatDate(item.occurredAt, locale, {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {item.sleepHours !== null
                      ? ` · ${t('checkin.historySleep', { hours: item.sleepHours })}`
                      : ''}
                    {item.water !== null
                      ? ` · ${t('checkin.historyWater', { count: item.water })}`
                      : ''}
                    {item.steps !== null
                      ? ` · ${t('checkin.historySteps', { count: item.steps })}`
                      : ''}
                  </span>
                </span>
                {item.tags.length > 0 ? (
                  <span
                    className="flex flex-wrap gap-x-2 text-xs text-[var(--puls-wellbeing-text)]"
                    data-testid="checkin-history-tags"
                  >
                    {item.tags.map((tag) => (
                      <span key={tag}>#{tagLabel(tag)}</span>
                    ))}
                  </span>
                ) : null}
                {item.daySummary ? (
                  <span className="truncate text-sm" data-testid="checkin-history-summary">
                    {item.daySummary}
                  </span>
                ) : null}
                {item.note ? (
                  <span className="truncate text-xs text-[var(--puls-ink-muted)]">{item.note}</span>
                ) : null}
              </span>
              <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                {item.energy !== null ? (
                  <Badge tone="wellbeing">
                    {t('checkin.energy')} {item.energy}
                  </Badge>
                ) : null}
                {item.stress !== null ? (
                  <Badge tone="primary">
                    {t('checkin.stress')} {item.stress}
                  </Badge>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {history.length === 0 && !loading ? (
          <EmptyState icon="heart" tone="wellbeing" title={t('checkin.history.empty')} />
        ) : null}
        {history.length > visibleCount ? (
          <button
            type="button"
            data-testid="checkin-history-more"
            onClick={() => setVisibleCount((count) => count + HISTORY_PAGE)}
            className="h-11 w-fit self-center rounded-[var(--radius-button)] bg-[var(--puls-primary-soft)] px-5 text-sm font-semibold text-[var(--puls-primary-text)]"
          >
            {t('checkin.history.more')}
          </button>
        ) : null}
      </section>
    </div>
  );
}
