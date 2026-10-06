// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHexColor, relativeLuminance } from '../src/lib/contrast';
import { DARK_PALETTE, LIGHT_PALETTE, type ThemePalette } from '../src/lib/palette';

/** Пары «текст на фоне», которые обязаны проходить WCAG AA (ТЗ §6). */
function textPairs(palette: ThemePalette): Array<[string, string, string]> {
  return [
    ['ink/bg', palette.ink, palette.bg],
    ['ink/surface', palette.ink, palette.surface],
    ['inkMuted/bg', palette.inkMuted, palette.bg],
    ['inkMuted/surface', palette.inkMuted, palette.surface],
    ['primaryText/bg', palette.primaryText, palette.bg],
    ['primaryText/surface', palette.primaryText, palette.surface],
    ['financeText/bg', palette.financeText, palette.bg],
    ['financeText/surface', palette.financeText, palette.surface],
    ['wellbeingText/bg', palette.wellbeingText, palette.bg],
    ['wellbeingText/surface', palette.wellbeingText, palette.surface],
    ['warningText/bg', palette.warningText, palette.bg],
    ['warningText/surface', palette.warningText, palette.surface],
    ['onPrimary/primary', palette.onPrimary, palette.primary],
    ['ink/surface2', palette.ink, palette.surface2],
    ['inkMuted/surface2', palette.inkMuted, palette.surface2],
    ['primaryText/primarySoft', palette.primaryText, palette.primarySoft],
    ['financeText/financeSoft', palette.financeText, palette.financeSoft],
    ['wellbeingText/wellbeingSoft', palette.wellbeingText, palette.wellbeingSoft],
    ['warningText/warningSoft', palette.warningText, palette.warningSoft],
    ['ink/primarySoft', palette.ink, palette.primarySoft],
    ['inkMuted/primarySoft', palette.inkMuted, palette.primarySoft],
    ['inkMuted/financeSoft', palette.inkMuted, palette.financeSoft],
    ['inkMuted/wellbeingSoft', palette.inkMuted, palette.wellbeingSoft],
    ['inkMuted/warningSoft', palette.inkMuted, palette.warningSoft],
  ];
}

describe('расчёт контраста (ТЗ §6, WCAG 2.1 AA)', () => {
  it('разбирает hex-цвета и отвергает мусор', () => {
    expect(parseHexColor('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor('#000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(() => parseHexColor('rebeccapurple')).toThrow();
  });

  it('считает относительную яркость по формуле WCAG', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('даёт 21:1 для чёрного на белом и 1:1 для одинаковых цветов', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
    expect(contrastRatio('#5B5BD6', '#5B5BD6')).toBeCloseTo(1, 5);
  });

  it('симметричен относительно порядка аргументов', () => {
    expect(contrastRatio('#F2A25C', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#F2A25C'), 5);
  });

  it('держит 4.5:1 для всех текстовых пар светлой темы', () => {
    for (const [name, foreground, background] of textPairs(LIGHT_PALETTE)) {
      expect(contrastRatio(foreground, background), `светлая: ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('держит 4.5:1 для всех текстовых пар тёмной темы', () => {
    for (const [name, foreground, background] of textPairs(DARK_PALETTE)) {
      expect(contrastRatio(foreground, background), `тёмная: ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('держит 3:1 для границ и элементов управления (AA non-text)', () => {
    expect(contrastRatio(LIGHT_PALETTE.focus, LIGHT_PALETTE.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(LIGHT_PALETTE.focus, LIGHT_PALETTE.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(DARK_PALETTE.focus, DARK_PALETTE.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(DARK_PALETTE.focus, DARK_PALETTE.surface)).toBeGreaterThanOrEqual(3);
  });

  it('держит 3:1 для границ полей ввода (lineStrong) в обеих темах', () => {
    for (const palette of [LIGHT_PALETTE, DARK_PALETTE]) {
      for (const background of [palette.bg, palette.surface, palette.surface2]) {
        expect(contrastRatio(palette.lineStrong, background)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('палитра совпадает с CSS-переменными', () => {
  const css = readFileSync(join('src', 'app', 'globals.css'), 'utf8');

  function block(selector: string): string {
    const match = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`).exec(css);
    if (!match) throw new Error(`в globals.css нет блока ${selector}`);
    return match[1];
  }

  function value(blockSource: string, name: string): string {
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(blockSource);
    if (!match) throw new Error(`в globals.css нет переменной ${name}`);
    return match[1].trim().toLowerCase();
  }

  const light = block(':root');
  const dark = block('.dark');

  const checks: Array<[string, string]> = [
    ['--puls-bg', 'bg'],
    ['--puls-surface', 'surface'],
    ['--puls-primary', 'primary'],
    ['--puls-finance', 'finance'],
    ['--puls-wellbeing', 'wellbeing'],
    ['--puls-warning', 'warning'],
    ['--puls-ink', 'ink'],
    ['--puls-ink-muted', 'inkMuted'],
    ['--puls-on-primary', 'onPrimary'],
    ['--puls-primary-text', 'primaryText'],
    ['--puls-finance-text', 'financeText'],
    ['--puls-wellbeing-text', 'wellbeingText'],
    ['--puls-warning-text', 'warningText'],
    ['--puls-focus', 'focus'],
    ['--puls-surface-2', 'surface2'],
    ['--puls-primary-soft', 'primarySoft'],
    ['--puls-finance-soft', 'financeSoft'],
    ['--puls-wellbeing-soft', 'wellbeingSoft'],
    ['--puls-warning-soft', 'warningSoft'],
    ['--puls-line-strong', 'lineStrong'],
  ];

  it('светлая тема в CSS и в TS совпадают', () => {
    for (const [cssName, key] of checks) {
      expect(value(light, cssName), cssName).toBe(LIGHT_PALETTE[key as keyof ThemePalette]);
    }
  });

  it('тёмная тема в CSS и в TS совпадают', () => {
    for (const [cssName, key] of checks) {
      expect(value(dark, cssName), cssName).toBe(DARK_PALETTE[key as keyof ThemePalette]);
    }
  });
});
