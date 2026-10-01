// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useMemo } from 'react';

const COLORS = [
  'var(--puls-primary)',
  'var(--puls-finance)',
  'var(--puls-wellbeing)',
  'var(--puls-warning)',
];

interface Piece {
  key: number;
  left: number;
  drift: number;
  delay: number;
  duration: number;
  color: string;
  rotate: number;
}

/**
 * CSS-анимация конфетти при получении достижения (ТЗ §4, §8). Чисто
 * декоративна и скрыта от скринридеров; при prefers-reduced-motion слой
 * скрывается правилом в globals.css.
 */
export function Confetti({ count = 28 }: { count?: number }) {
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        left: (index * 37) % 100,
        drift: ((index * 53) % 120) - 60,
        delay: (index % 10) * 60,
        duration: 1600 + ((index * 137) % 900),
        color: COLORS[index % COLORS.length]!,
        rotate: (index * 47) % 360,
      })),
    [count],
  );

  return (
    <div className="puls-confetti" aria-hidden="true" data-testid="confetti">
      {pieces.map((piece) => (
        <span
          key={piece.key}
          className="puls-confetti__piece"
          style={{
            left: `${piece.left}%`,
            backgroundColor: piece.color,
            transform: `rotate(${piece.rotate}deg)`,
            animationDelay: `${piece.delay}ms`,
            animationDuration: `${piece.duration}ms`,
            ['--puls-confetti-drift' as string]: `${piece.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
