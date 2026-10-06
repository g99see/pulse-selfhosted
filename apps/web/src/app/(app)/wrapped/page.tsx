// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { WrappedResponse } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { categoryLabel } from '@/lib/category-label';
import { Money } from '@/components/money';
import { IconBubble } from '@/components/ui';
import { formatDate, formatNumber } from '@/lib/format';
import { wrappedApi } from '@/lib/wrapped-client';

/** Слайд «сторис»: ключ и содержимое. */
interface Slide {
  key: string;
  node: ReactNode;
}

/** Мягкие пастельные фоны слайдов в цветах областей; текст — основные чернила (AA на светлых и тёмных токенах). */
const SLIDE_BG: Record<string, string> = {
  cover: 'linear-gradient(160deg, var(--puls-primary-soft), var(--puls-wellbeing-soft))',
  empty: 'var(--puls-surface)',
  money: 'linear-gradient(160deg, var(--puls-finance-soft), var(--puls-surface))',
  categories: 'linear-gradient(160deg, var(--puls-primary-soft), var(--puls-surface))',
  days: 'linear-gradient(160deg, var(--puls-warning-soft), var(--puls-surface))',
  mood: 'linear-gradient(160deg, var(--puls-wellbeing-soft), var(--puls-surface))',
  checkins: 'linear-gradient(160deg, var(--puls-wellbeing-soft), var(--puls-primary-soft))',
  goals: 'linear-gradient(160deg, var(--puls-finance-soft), var(--puls-primary-soft))',
  share: 'linear-gradient(160deg, var(--puls-primary-soft), var(--puls-finance-soft))',
};

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Экран «Год в цифрах» (ТЗ §4, P2): итоговая история в стиле Spotify Wrapped.
 * Листается кнопками и стрелками клавиатуры, доступен круглый год. При
 * prefers-reduced-motion смена слайда идёт без анимации.
 */
export default function WrappedPage() {
  const { t, locale } = useT();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [data, setData] = useState<WrappedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [slide, setSlide] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(true);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied'>('idle');

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setData(await wrappedApi.year(year));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const onChange = (): void => setReducedMotion(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const isEmpty =
    data !== null &&
    data.spent === 0 &&
    data.earned === 0 &&
    data.checkins === 0 &&
    data.closedGoals === 0 &&
    data.achievements === 0;

  const slides = useMemo<Slide[]>(() => {
    if (!data) return [];
    const currency = data.currency as never;
    const monthName = (month: string): string =>
      formatDate(`${month}-01`, locale, { month: 'long' });
    const number = (value: number): string =>
      formatNumber(value, locale, { maximumFractionDigits: 1 });

    const result: Slide[] = [
      {
        key: 'cover',
        node: (
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-[var(--puls-primary-text)]">
              {t('wrapped.cover.tagline')}
            </p>
            <p className="text-6xl font-extrabold [font-variant-numeric:tabular-nums]">
              {data.year}
            </p>
            <p className="text-lg text-[var(--puls-ink-muted)]">{t('wrapped.cover.subtitle')}</p>
          </div>
        ),
      },
    ];

    if (isEmpty) {
      result.push({
        key: 'empty',
        node: (
          <div className="flex flex-col gap-3 text-center">
            <p className="text-2xl font-bold">{t('wrapped.empty.title')}</p>
            <p className="text-[var(--puls-ink-muted)]">{t('wrapped.empty.body')}</p>
          </div>
        ),
      });
      return result;
    }

    result.push({
      key: 'money',
      node: (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">{t('wrapped.money.title')}</h2>
          <dl className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[var(--puls-ink-muted)]">{t('wrapped.money.spent')}</dt>
              <dd className="text-3xl font-extrabold text-[var(--puls-warning-text)]">
                <Money value={data.spent} currency={currency} testId="wrapped-spent" />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[var(--puls-ink-muted)]">{t('wrapped.money.earned')}</dt>
              <dd className="text-3xl font-extrabold text-[var(--puls-finance-text)]">
                <Money value={data.earned} currency={currency} />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[var(--puls-ink-muted)]">{t('wrapped.money.net')}</dt>
              <dd className="text-2xl font-bold">
                <Money value={data.net} currency={currency} />
              </dd>
            </div>
          </dl>
        </div>
      ),
    });

    result.push({
      key: 'categories',
      node: (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">{t('wrapped.categories.title')}</h2>
          {data.topCategories.length === 0 ? (
            <p className="text-[var(--puls-ink-muted)]">{t('wrapped.categories.empty')}</p>
          ) : (
            <ol className="flex flex-col gap-3" data-testid="wrapped-categories">
              {data.topCategories.map((category, index) => (
                <li
                  key={category.categoryId ?? 'none'}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-2xl font-extrabold text-[var(--puls-primary-text)]">
                      {index + 1}
                    </span>
                    <span className="font-medium">
                      {category.categoryName
                        ? categoryLabel({ id: category.categoryId, name: category.categoryName }, t)
                        : t('wrapped.categories.other')}
                    </span>
                  </span>
                  <Money
                    value={category.total}
                    currency={currency}
                    className="font-bold [font-variant-numeric:tabular-nums]"
                  />
                </li>
              ))}
            </ol>
          )}
        </div>
      ),
    });

    result.push({
      key: 'days',
      node: (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">{t('wrapped.day.title')}</h2>
          {data.mostExpensiveDay ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-[var(--puls-ink-muted)]">
                {t('wrapped.day.mostExpensive')}
              </p>
              <p className="text-lg font-bold">
                {formatDate(data.mostExpensiveDay.day, locale, { day: 'numeric', month: 'long' })}
              </p>
              <Money
                value={data.mostExpensiveDay.spent}
                currency={currency}
                className="text-3xl font-extrabold text-[var(--puls-warning-text)]"
              />
            </div>
          ) : null}
          {data.mostFrequentWeekday ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-[var(--puls-ink-muted)]">{t('wrapped.day.weekday')}</p>
              <p className="text-2xl font-bold">
                {t(`stats.weekday.${data.mostFrequentWeekday.weekday}`)}
              </p>
              <p className="text-sm text-[var(--puls-ink-muted)]">
                {t('wrapped.day.weekdayCount', { count: data.mostFrequentWeekday.count })}
              </p>
            </div>
          ) : null}
        </div>
      ),
    });

    result.push({
      key: 'mood',
      node: (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">{t('wrapped.mood.title')}</h2>
          {data.avgMood === null ? (
            <p className="text-[var(--puls-ink-muted)]">{t('wrapped.mood.none')}</p>
          ) : (
            <p
              className="text-5xl font-extrabold [font-variant-numeric:tabular-nums]"
              data-testid="wrapped-mood"
            >
              {number(data.avgMood)}
            </p>
          )}
          {data.bestMonth ? (
            <p className="text-[var(--puls-finance-text)]">
              {t('wrapped.mood.bestMonth', {
                month: monthName(data.bestMonth.month),
                value: number(data.bestMonth.avgMood),
              })}
            </p>
          ) : null}
          {data.worstMonth ? (
            <p className="text-[var(--puls-ink-muted)]">
              {t('wrapped.mood.worstMonth', {
                month: monthName(data.worstMonth.month),
                value: number(data.worstMonth.avgMood),
              })}
            </p>
          ) : null}
        </div>
      ),
    });

    result.push({
      key: 'checkins',
      node: (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">{t('wrapped.checkins.title')}</h2>
          <p
            className="text-5xl font-extrabold [font-variant-numeric:tabular-nums]"
            data-testid="wrapped-checkins"
          >
            {number(data.checkins)}
          </p>
          <p className="text-[var(--puls-ink-muted)]">
            {t('wrapped.checkins.streak', { days: data.bestStreak })}
          </p>
        </div>
      ),
    });

    result.push({
      key: 'goals',
      node: (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">{t('wrapped.goals.title')}</h2>
          <p className="text-3xl font-extrabold [font-variant-numeric:tabular-nums]">
            {t('wrapped.goals.closed', { count: data.closedGoals })}
          </p>
          <p className="text-3xl font-extrabold [font-variant-numeric:tabular-nums]">
            {t('wrapped.goals.achievements', { count: data.achievements })}
          </p>
        </div>
      ),
    });

    result.push({
      key: 'share',
      node: (
        <div className="flex flex-col items-center gap-4 text-center">
          <h2 className="text-xl font-bold">{t('wrapped.share.title')}</h2>
          <p className="text-[var(--puls-ink-muted)]">{t('wrapped.share.body')}</p>
          <button
            type="button"
            data-testid="wrapped-share"
            onClick={() => void share()}
            className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-5 text-sm font-semibold text-[var(--puls-on-primary)]"
          >
            {t('wrapped.share.button')}
          </button>
          <p aria-live="polite" role="status" className="text-xs text-[var(--puls-ink-muted)]">
            {shareStatus === 'copied' ? t('wrapped.share.copied') : ''}
          </p>
        </div>
      ),
    });

    return result;
  }, [data, isEmpty, locale, t, shareStatus]);

  // Смена слайда с лёгкой анимацией; при reduced motion — мгновенно.
  useEffect(() => {
    if (reducedMotion) {
      setVisible(true);
      return;
    }
    setVisible(false);
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [slide, reducedMotion]);

  const go = useCallback(
    (next: number) => {
      setSlide(() => {
        const max = Math.max(slides.length - 1, 0);
        return Math.min(Math.max(next, 0), max);
      });
      setShareStatus('idle');
    },
    [slides.length],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'ArrowRight') go(slide + 1);
      else if (event.key === 'ArrowLeft') go(slide - 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, slide]);

  async function share(): Promise<void> {
    const text = t('wrapped.share.text', { year });
    const nav = navigator as Navigator & { share?: (payload: ShareData) => Promise<void> };
    try {
      if (typeof nav.share === 'function') {
        await nav.share({ title: t('wrapped.title'), text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setShareStatus('copied');
    } catch {
      // Пользователь отменил или нет доступа — тихо остаёмся на слайде.
    }
  }

  const total = slides.length;
  const current = slides[slide];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconBubble name="sparkle" tone="primary" size={44} />
          <h1 className="text-2xl font-extrabold">{t('wrapped.title')}</h1>
        </div>
        <Link
          href="/stats"
          className="rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-4 py-2 text-sm font-semibold text-[var(--puls-primary-text)]"
          data-testid="wrapped-to-stats"
        >
          {t('stats.title')}
        </Link>
      </div>

      <div
        className="flex items-center justify-center gap-3"
        role="group"
        aria-label={t('wrapped.year.label')}
      >
        <button
          type="button"
          data-testid="wrapped-year-prev"
          onClick={() => {
            setSlide(0);
            setYear((value) => value - 1);
          }}
          className="rounded-[var(--radius-chip)] bg-[var(--puls-surface)] px-4 py-1.5 text-sm font-semibold shadow-sm"
        >
          {t('wrapped.year.prev')}
        </button>
        <span className="font-bold [font-variant-numeric:tabular-nums]" data-testid="wrapped-year">
          {year}
        </span>
        <button
          type="button"
          data-testid="wrapped-year-next"
          disabled={year >= CURRENT_YEAR}
          onClick={() => {
            setSlide(0);
            setYear((value) => value + 1);
          }}
          className="rounded-[var(--radius-chip)] bg-[var(--puls-surface)] px-4 py-1.5 text-sm font-semibold shadow-sm disabled:opacity-40"
        >
          {t('wrapped.year.next')}
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--puls-warning-text)]">
          {t('wrapped.error')}
        </p>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-[var(--puls-ink-muted)]" role="status">
          {t('wrapped.loading')}
        </p>
      ) : null}

      {data && current ? (
        <div
          className="flex min-h-80 flex-col gap-6 rounded-[var(--radius-sheet)] p-6 shadow-sm sm:p-8"
          style={{ background: SLIDE_BG[current.key] ?? SLIDE_BG.cover }}
        >
          <div
            role="group"
            aria-roledescription={t('wrapped.slide.role')}
            aria-label={t('wrapped.slide.of', { current: slide + 1, total })}
            data-testid="wrapped-slide"
            data-slide={current.key}
            className="flex flex-1 items-center justify-center"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? 'none' : 'translateX(16px)',
              transition: reducedMotion ? 'none' : 'opacity 220ms ease, transform 220ms ease',
            }}
          >
            {current.node}
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              data-testid="wrapped-prev"
              disabled={slide === 0}
              onClick={() => go(slide - 1)}
              className="rounded-[var(--radius-chip)] bg-[var(--puls-surface)] px-5 py-2 text-sm font-semibold shadow-sm disabled:opacity-40"
            >
              {t('common.back')}
            </button>
            <span className="text-xs text-[var(--puls-ink-muted)] [font-variant-numeric:tabular-nums]">
              {slide + 1} / {total}
            </span>
            <button
              type="button"
              data-testid="wrapped-next"
              disabled={slide >= total - 1}
              onClick={() => go(slide + 1)}
              className="rounded-[var(--radius-chip)] bg-[var(--puls-surface)] px-5 py-2 text-sm font-semibold shadow-sm disabled:opacity-40"
            >
              {t('common.next')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
