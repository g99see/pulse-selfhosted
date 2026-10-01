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
}

export const LIGHT_PALETTE: ThemePalette = {
  bg: '#faf8f5',
  surface: '#ffffff',
  primary: '#5b5bd6',
  finance: '#2ba889',
  wellbeing: '#f2a25c',
  warning: '#e5484d',
  ink: '#1c1c24',
  inkMuted: '#6e6e7a',
  onPrimary: '#ffffff',
  primaryText: '#5b5bd6',
  financeText: '#17705a',
  wellbeingText: '#a85a12',
  warningText: '#b3261e',
  focus: '#5b5bd6',
};

export const DARK_PALETTE: ThemePalette = {
  bg: '#14141a',
  surface: '#1e1e26',
  primary: '#8b8bf5',
  finance: '#3dd6ae',
  wellbeing: '#f7b87e',
  warning: '#ff6369',
  ink: '#ededf2',
  inkMuted: '#9a9aa8',
  onPrimary: '#14141a',
  primaryText: '#8b8bf5',
  financeText: '#3dd6ae',
  wellbeingText: '#f7b87e',
  warningText: '#ff6369',
  focus: '#8b8bf5',
};
