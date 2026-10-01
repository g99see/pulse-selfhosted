// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Палитра «спокойный компаньон» (ТЗ §8) в виде данных.
 *
 * Значения обязаны совпадать с CSS-переменными в app/globals.css — это
 * проверяет unit-тест, поэтому палитру нельзя поменять в одном месте.
 * Текстовые варианты (`*Text`, `onPrimary`) подобраны так, чтобы контраст
 * пары «текст на фоне» был не ниже 4.5:1 в обеих темах (ТЗ §6, WCAG AA).
 */

export interface ThemePalette {
  /** Основной фон. */
  bg: string;
  /** Карточки и модальные окна. */
  surface: string;
  /** Брендовый индиго (кнопки, акценты, заливки). */
  primary: string;
  finance: string;
  wellbeing: string;
  warning: string;
  /** Основной текст. */
  ink: string;
  /** Подписи и пояснения. */
  inkMuted: string;
  /** Текст на заливке primary. */
  onPrimary: string;
  /** Индиго для текста и ссылок. */
  primaryText: string;
  financeText: string;
  wellbeingText: string;
  warningText: string;
  /** Кольцо фокуса. */
  focus: string;
  /** Вторая поверхность: поля ввода, вложенные блоки. */
  surface2: string;
  /** Мягкие заливки областей (фон плиток и бейджей с текстом *Text). */
  primarySoft: string;
  financeSoft: string;
  wellbeingSoft: string;
  warningSoft: string;
}

export const LIGHT_PALETTE: ThemePalette = {
  bg: '#f6f2ec',
  surface: '#ffffff',
  surface2: '#faf7f2',
  primary: '#5d55c9',
  finance: '#3fae84',
  wellbeing: '#f19a57',
  warning: '#e5544d',
  ink: '#24212d',
  inkMuted: '#66626f',
  onPrimary: '#ffffff',
  primaryText: '#5048bd',
  financeText: '#1c6a50',
  wellbeingText: '#9c4f15',
  warningText: '#b0302b',
  focus: '#5d55c9',
  primarySoft: '#ecebfa',
  financeSoft: '#e2f3ea',
  wellbeingSoft: '#fdecdc',
  warningSoft: '#fce6e3',
};

export const DARK_PALETTE: ThemePalette = {
  bg: '#15141b',
  surface: '#1f1e27',
  surface2: '#1a1922',
  primary: '#a59ffa',
  finance: '#5cc79c',
  wellbeing: '#f3a86c',
  warning: '#ff7b75',
  ink: '#f0eef6',
  inkMuted: '#a7a3b4',
  onPrimary: '#15141b',
  primaryText: '#b1acff',
  financeText: '#74d5ae',
  wellbeingText: '#f6bd8c',
  warningText: '#ff918b',
  focus: '#a59ffa',
  primarySoft: '#2b2945',
  financeSoft: '#1b3129',
  wellbeingSoft: '#38291d',
  warningSoft: '#3b2225',
};
