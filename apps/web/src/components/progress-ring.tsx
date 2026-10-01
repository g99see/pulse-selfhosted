// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from 'react';

/**
 * Кольцо прогресса цели (ТЗ §8: «прогресс показывается кольцами»).
 * Заполнение анимируется 200 мс; при prefers-reduced-motion движение убирает
 * глобальный стиль globals.css.
 */
export function ProgressRing({
  percent,
  label,
  size = 96,
  stroke = 8,
  children,
}: {
  percent: number;
  label: string;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const center = size / 2;

  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--puls-ink-muted)"
          strokeOpacity={0.2}
          strokeWidth={stroke}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--puls-finance)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: 'stroke-dashoffset var(--puls-duration-base) ease-out' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        {children ?? (
          <span className="font-bold [font-variant-numeric:tabular-nums]">{clamped}%</span>
        )}
      </span>
    </span>
  );
}
