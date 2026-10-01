// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/** Карточка 16px (ТЗ §8). */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

/** Поле формы с подписью, подсказкой и ошибкой (доступность: aria-describedby). */
export function Field({
  label,
  hint,
  error,
  id,
  ...inputProps
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; id: string }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        {...inputProps}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        className="h-12 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-4 text-base outline-none focus:border-[var(--puls-primary)] focus:ring-2 focus:ring-[var(--puls-primary)]/30"
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-[var(--puls-ink-muted)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-[var(--puls-warning-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Select({
  label,
  id,
  children,
  ...selectProps
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        {...selectProps}
        id={id}
        className="h-12 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 bg-[var(--puls-bg)] px-4 text-base outline-none focus:border-[var(--puls-primary)] focus:ring-2 focus:ring-[var(--puls-primary)]/30"
      >
        {children}
      </select>
    </div>
  );
}

export function PrimaryButton({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="h-12 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 font-semibold text-[var(--puls-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="h-12 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 px-6 font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' }) {
  // Цвет текста — контрастные токены *-text (WCAG AA в обеих темах), рамка — базовый.
  const border = tone === 'error' ? 'var(--puls-warning)' : 'var(--puls-finance)';
  const color = tone === 'error' ? 'var(--puls-warning-text)' : 'var(--puls-finance-text)';
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className="rounded-[var(--radius-button)] border px-4 py-3 text-sm"
      style={{ borderColor: border, color }}
    >
      {children}
    </p>
  );
}

/** Полоса прогресса онбординга (ТЗ §8: прогресс кольцами и полосами). */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = Math.round((value / max) * 100);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm text-[var(--puls-ink-muted)]">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-[var(--radius-chip)] bg-[var(--puls-ink-muted)]/20"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
      >
        <div
          className="h-full rounded-[var(--radius-chip)] bg-[var(--puls-primary)] transition-all duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
