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
  const dimension = size === 'lg' ? 'h-16 w-16 text-3xl' : 'h-14 w-14 text-2xl';

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
            className={`flex ${dimension} items-center justify-center rounded-full transition-transform duration-150 disabled:opacity-60`}
            style={{
              backgroundColor: active ? MOOD_COLORS[mood] : 'transparent',
              border: `2px solid ${MOOD_COLORS[mood]}`,
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
      <div className="flex gap-2">
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
              className="h-11 flex-1 rounded-[var(--radius-button)] border text-sm font-semibold transition-colors duration-150 disabled:opacity-60"
              style={{
                borderColor: active ? 'var(--puls-primary)' : 'color-mix(in srgb, var(--puls-ink-muted) 30%, transparent)',
                backgroundColor: active ? 'var(--puls-primary)' : 'transparent',
                color: active ? 'var(--puls-on-primary)' : 'inherit',
              }}
            >
              {level}
            </button>
          );
        })}
      </div>
      <span className="text-xs text-[var(--puls-ink-muted)]">
        {t('checkin.scale.hint')}
      </span>
    </fieldset>
  );
}
