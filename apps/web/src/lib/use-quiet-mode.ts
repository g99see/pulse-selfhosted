// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

/**
 * Режим «Тишина» (ТЗ §4, P1): клиентское состояние без бэкенда. Включённый
 * режим прячет денежные суммы на экранах. Состояние хранится в localStorage и
 * cookie, на <html> выставляется атрибут data-quiet, чтобы стили могли
 * подстраховать рендер. Подписка одна на вкладку: компоненты читают флаг через
 * useQuietMode() и перерисовываются при переключении (в т.ч. из другой вкладки).
 */
import { useSyncExternalStore } from 'react';

export const QUIET_STORAGE_KEY = 'puls_quiet';
export const QUIET_COOKIE = 'puls_quiet';
export const QUIET_ATTR = 'data-quiet';
export const QUIET_EVENT = 'puls:quiet-changed';

let current = false;
let initialized = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function readLocal(): boolean {
  try {
    return window.localStorage.getItem(QUIET_STORAGE_KEY) === '1';
  } catch {
    // Приватный режим — читаем cookie как запасной источник.
    return (
      typeof document !== 'undefined' &&
      document.cookie.split('; ').includes(`${QUIET_COOKIE}=1`)
    );
  }
}

function persist(next: boolean): void {
  try {
    if (next) window.localStorage.setItem(QUIET_STORAGE_KEY, '1');
    else window.localStorage.removeItem(QUIET_STORAGE_KEY);
  } catch {
    // localStorage может быть недоступен — переживём до перезагрузки.
  }
  try {
    document.cookie = next
      ? `${QUIET_COOKIE}=1; path=/; max-age=31536000; SameSite=Lax`
      : `${QUIET_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    // Cookie может быть недоступен — не критично.
  }
}

function applyDom(next: boolean): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (next) root.setAttribute(QUIET_ATTR, 'true');
  else root.removeAttribute(QUIET_ATTR);
}

/** Меняет состояние, сохраняет его и оповещает подписчиков. */
export function setQuietMode(next: boolean): void {
  current = next;
  persist(next);
  applyDom(next);
  emit();
}

/** Инвертирует режим «Тишина». */
export function toggleQuietMode(): void {
  setQuietMode(!current);
}

/** Текущее значение без подписки (для обработчиков и тестов). */
export function quietModeValue(): boolean {
  return current;
}

function ensureInit(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  current = readLocal();
  applyDom(current);
  window.addEventListener('storage', (event) => {
    if (event.key !== QUIET_STORAGE_KEY) return;
    const next = event.newValue === '1';
    if (next === current) return;
    current = next;
    applyDom(next);
    emit();
  });
}

function subscribe(listener: () => void): () => void {
  ensureInit();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return current;
}

function getServerSnapshot(): boolean {
  return false;
}

/** Флаг режима «Тишина» с подпиской на изменения. */
export function useQuietMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
