// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { MOOD_COLORS, MOOD_EMOJI, MOOD_SCALE, type Mood } from '@puls/shared';
import { useT } from '@/components/locale-provider';

/**
 * Шкала настроения 1–5 эмодзи-кнопками (ТЗ §3.3, §8): ответ за 5 секунд.
 * Цвета из §8 — от приглушённого синего к солнечно-жёлтому, без красного.
 */
export function MoodScale({
  value,
  onChange,
  disabled = false,
  size = 'md',
}: {
  value: Mood | null;
  onChange: (mood: Mood) => void;
  disabled?: boolean;
  size?: 'md' | 'lg';
}) {
  const { t } = useT();
  // На узких экранах кружки сжимаются (aspect-square), чтобы пять лиц всегда помещались в строку.
  const dimension =
    size === 'lg'
      ? 'aspect-square w-[4.25rem] min-w-11 shrink text-2xl sm:text-3xl'
      : 'aspect-square w-14 min-w-11 shrink text-2xl';

  return (
    <div
      role="radiogroup"
      aria-label={t('checkin.mood.label')}
      data-testid="mood-scale"
      className="flex items-center justify-between gap-2"
    >
      {MOOD_SCALE.map((mood) => {
        const active = value === mood;
        return (
          <button
            key={mood}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={t(`checkin.mood.${mood}`)}
            data-testid={`mood-${mood}`}
            disabled={disabled}
            onClick={() => onChange(mood)}
            className={`flex ${dimension} items-center justify-center rounded-full transition-transform duration-150 hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--puls-wellbeing-text)] disabled:opacity-60`}
            style={{
              backgroundColor: `color-mix(in srgb, ${MOOD_COLORS[mood]} ${active ? 55 : 28}%, var(--puls-surface))`,
              boxShadow: active
                ? '0 0 0 3px var(--puls-surface), 0 0 0 5px var(--puls-wellbeing-text)'
                : undefined,
              transform: active ? 'scale(1.08)' : undefined,
            }}
          >
            <span aria-hidden="true">{MOOD_EMOJI[mood]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Шкала 1–5 для энергии и стресса (ТЗ §3.3) — крупные кнопки, без оценки «плохо/хорошо». */
export function MetricScale({
  value,
  onChange,
  labels,
  testId,
  disabled = false,
}: {
  value: number | null;
  onChange: (value: number) => void;
  labels: { legend: string; option: (value: number) => string };
  testId: string;
  disabled?: boolean;
}) {
  const { t } = useT();

  return (
    <fieldset className="flex flex-col gap-2" data-testid={testId}>
      <legend className="text-sm font-medium">{labels.legend}</legend>
      <div className="flex gap-1 rounded-[var(--radius-chip)] bg-[var(--puls-surface-2)] p-1">
        {MOOD_SCALE.map((level) => {
          const active = value === level;
          return (
            <button
              key={level}
              type="button"
              aria-pressed={active}
              aria-label={labels.option(level)}
              disabled={disabled}
              onClick={() => onChange(level)}
              className={`h-11 flex-1 rounded-[var(--radius-chip)] text-sm font-semibold transition-colors duration-150 disabled:opacity-60 ${
                active
                  ? 'bg-[var(--puls-wellbeing-soft)] text-[var(--puls-wellbeing-text)] shadow-sm ring-2 ring-[var(--puls-wellbeing)]'
                  : 'text-[var(--puls-ink-muted)] hover:bg-[var(--puls-surface)]'
              }`}
            >
              {level}
            </button>
          );
        })}
      </div>
      <span className="text-xs text-[var(--puls-ink-muted)]">{t('checkin.scale.hint')}</span>
    </fieldset>
  );
}
