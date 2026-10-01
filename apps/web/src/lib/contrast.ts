// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Расчёт контраста по WCAG 2.1 (ТЗ §6). Чистые функции: их используют тесты
 * палитры, чтобы доступность обеих тем проверялась расчётом, а не на глаз.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Разбирает #rgb или #rrggbb; бросает ошибку на неподдерживаемом формате. */
export function parseHexColor(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, '');

  if (value.length === 3) {
    return {
      r: parseInt(`${value[0]}${value[0]}`, 16),
      g: parseInt(`${value[1]}${value[1]}`, 16),
      b: parseInt(`${value[2]}${value[2]}`, 16),
    };
  }

  if (value.length === 6) {
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }

  throw new Error(`Неподдерживаемый цвет: ${hex}`);
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Относительная яркость цвета (0 — чёрный, 1 — белый). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHexColor(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** Контраст двух цветов: от 1 (совпадают) до 21 (чёрный на белом). */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
