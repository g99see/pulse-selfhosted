// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Палитра «пульс-монитор» (ТЗ §8, docs/REDESIGN-V2.md) в виде данных.
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
  /** Бренд — глубокий бирюзовый (кнопки, акценты, заливки). */
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
  /** Бирюзовый для текста и ссылок. */
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
  /** Граница полей ввода и элементов управления (AA non-text, ≥ 3:1). */
  lineStrong: string;
}

export const LIGHT_PALETTE: ThemePalette = {
  bg: '#e9f0ea',
  surface: '#fafdfb',
  surface2: '#f0f6f1',
  primary: '#0d5c55',
  finance: '#6fae1f',
  wellbeing: '#f0a30a',
  warning: '#e0452d',
  ink: '#0f2620',
  inkMuted: '#485d54',
  onPrimary: '#f4fbf8',
  primaryText: '#0d5c55',
  financeText: '#35650f',
  wellbeingText: '#764c00',
  warningText: '#b02a17',
  focus: '#0d5c55',
  primarySoft: '#d3ebe5',
  financeSoft: '#e0f0c9',
  wellbeingSoft: '#fbe9b8',
  warningSoft: '#fde0d9',
  lineStrong: '#6a8278',
};

export const DARK_PALETTE: ThemePalette = {
  bg: '#091210',
  surface: '#101c19',
  surface2: '#0d1714',
  primary: '#5fe3c9',
  finance: '#a6e05c',
  wellbeing: '#ffc23d',
  warning: '#ff7f69',
  ink: '#e8f3ee',
  inkMuted: '#9db3a9',
  onPrimary: '#04211c',
  primaryText: '#6ee7d0',
  financeText: '#b4e87a',
  wellbeingText: '#ffcf6b',
  warningText: '#ff9a85',
  focus: '#5fe3c9',
  primarySoft: '#12342e',
  financeSoft: '#1f3010',
  wellbeingSoft: '#33290a',
  warningSoft: '#3a1a14',
  lineStrong: '#6f897d',
};
