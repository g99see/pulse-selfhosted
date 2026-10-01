// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { Icon, type IconName } from '@/components/icons';

/** Цветовые тона областей (docs/REDESIGN.md): деньги, самочувствие, бренд, предупреждение. */
export type Tone = 'primary' | 'finance' | 'wellbeing' | 'warning' | 'neutral';

const TONE_SOFT: Record<Tone, string> = {
  primary: 'bg-[var(--puls-primary-soft)] text-[var(--puls-primary-text)]',
  finance: 'bg-[var(--puls-finance-soft)] text-[var(--puls-finance-text)]',
  wellbeing: 'bg-[var(--puls-wellbeing-soft)] text-[var(--puls-wellbeing-text)]',
  warning: 'bg-[var(--puls-warning-soft)] text-[var(--puls-warning-text)]',
  neutral: 'bg-[var(--puls-surface-2)] text-[var(--puls-ink-muted)]',
};

/** Классы мягкой плашки тона — для мест, где нужен только цвет. */
export function toneClasses(tone: Tone): string {
  return TONE_SOFT[tone];
}

/** Карточка: скругление 24px, мягкая тень (ТЗ §8, docs/REDESIGN.md). */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm sm:p-6 ${className}`}
    >
      {children}
    </div>
  );
}

const INPUT_CLASS =
  'h-12 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-4 text-base outline-none focus:border-[var(--puls-primary)] focus:ring-4 focus:ring-[var(--puls-primary)]/15';

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
        className={`${INPUT_CLASS} ${error ? 'border-[var(--puls-warning)]' : ''}`}
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
      <select {...selectProps} id={id} className={INPUT_CLASS}>
        {children}
      </select>
    </div>
  );
}

export function PrimaryButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`h-12 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 font-semibold text-[var(--puls-on-primary)] shadow-[0_8px_18px_-10px_var(--puls-primary)] transition-[transform,opacity] duration-150 hover:opacity-95 active:translate-y-px disabled:opacity-50 disabled:shadow-none ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`h-12 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface)] px-6 font-semibold transition-colors duration-150 hover:bg-[var(--puls-surface-2)] disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' }) {
  // Текст — контрастные токены *-text на мягкой заливке (WCAG AA в обеих темах).
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-[var(--radius-button)] px-4 py-3 text-sm ${
        tone === 'error' ? TONE_SOFT.warning : TONE_SOFT.finance
      }`}
    >
      {children}
    </p>
  );
}

/** Полоса прогресса (ТЗ §8: прогресс кольцами и полосами). */
export function ProgressBar({
  value,
  max,
  label,
  tone = 'primary',
}: {
  value: number;
  max: number;
  label: string;
  tone?: Exclude<Tone, 'neutral'>;
}) {
  const percent = Math.round((value / max) * 100);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm text-[var(--puls-ink-muted)]">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-[var(--radius-chip)] bg-[var(--puls-line)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
      >
        <div
          className="h-full rounded-[var(--radius-chip)] transition-all duration-200"
          style={{ width: `${percent}%`, backgroundColor: `var(--puls-${tone})` }}
        />
      </div>
    </div>
  );
}

/** Бейдж-пилюля в цвете области. */
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[var(--radius-chip)] px-2.5 py-1 text-xs font-semibold ${TONE_SOFT[tone]}`}
    >
      {children}
    </span>
  );
}

/** Скруглённая плашка с иконкой в цвете области. */
export function IconBubble({
  name,
  tone = 'primary',
  size = 40,
}: {
  name: IconName;
  tone?: Tone;
  size?: number;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[14px] ${TONE_SOFT[tone]}`}
      style={{ width: size, height: size }}
    >
      <Icon name={name} size={Math.round(size * 0.5)} />
    </span>
  );
}

/** Плитка показателя: подпись, крупное значение, пояснение; фон — мягкий тон области. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  icon?: IconName;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className={`flex flex-col gap-1 rounded-[20px] p-4 ${TONE_SOFT[tone]}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        {icon ? <Icon name={icon} size={15} /> : null}
        <span>{label}</span>
      </div>
      <div className="font-heading text-2xl font-extrabold text-[var(--puls-ink)]">{value}</div>
      {hint ? <div className="text-xs text-[var(--puls-ink-muted)]">{hint}</div> : null}
    </div>
  );
}

/** Пустое состояние с иллюстрацией: мягкие пастельные круги с иконкой, фраза и действие. */
export function EmptyState({
  icon = 'sparkle',
  tone = 'primary',
  title,
  text,
  action,
  as: Heading = 'p',
}: {
  icon?: IconName;
  tone?: Exclude<Tone, 'neutral'>;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  /** Тег заголовка: на странице, где пустое состояние — главное содержимое, это h1. */
  as?: 'p' | 'h1' | 'h2' | 'h3';
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <div className="relative h-24 w-28" aria-hidden="true">
        <svg width="112" height="96" viewBox="0 0 112 96" focusable="false">
          <circle cx="50" cy="52" r="34" fill={`var(--puls-${tone}-soft)`} />
          <circle cx="88" cy="28" r="14" fill="var(--puls-wellbeing-soft)" />
          <circle cx="92" cy="74" r="8" fill="var(--puls-finance-soft)" />
          <circle cx="14" cy="22" r="6" fill="var(--puls-primary-soft)" />
        </svg>
        <span
          className="absolute top-[34px] left-[32px] text-[var(--puls-ink)]"
          style={{ color: `var(--puls-${tone}-text)` }}
        >
          <Icon name={icon} size={36} />
        </span>
      </div>
      <Heading className="font-heading text-lg font-bold">{title}</Heading>
      {text ? <p className="max-w-sm text-sm text-[var(--puls-ink-muted)]">{text}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Сегментированный переключатель вкладок (кнопки с aria-pressed). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  fill = false,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; testId?: string }>;
  onChange: (value: T) => void;
  label: string;
  /** На всю ширину: на телефоне сетка 2×2, с sm — одна строка поровну. Все вкладки видны без прокрутки. */
  fill?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`${fill ? 'grid w-full grid-cols-2 sm:flex' : 'inline-flex max-w-full overflow-x-auto'} gap-1 rounded-[var(--radius-chip)] bg-[var(--puls-surface)] p-1 shadow-sm`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            data-testid={option.testId}
            onClick={() => onChange(option.value)}
            className={`${fill ? 'min-w-0 px-3 sm:flex-1 sm:px-4' : 'shrink-0 px-4'} rounded-[var(--radius-chip)] py-2 text-sm font-semibold whitespace-nowrap transition-colors duration-150 ${
              active
                ? 'bg-[var(--puls-primary)] text-[var(--puls-on-primary)]'
                : 'text-[var(--puls-ink-muted)] hover:bg-[var(--puls-surface-2)] hover:text-[var(--puls-ink)]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
