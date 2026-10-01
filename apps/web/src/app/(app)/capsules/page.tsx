// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  CapsuleCreateInput,
  CapsuleDetailDto,
  CapsulePreset,
  CapsuleSummaryDto,
  Currency,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, Badge, Card, EmptyState, IconBubble, PrimaryButton } from '@/components/ui';
import { authApi } from '@/lib/auth-client';
import { capsulesApi } from '@/lib/capsules-client';
import { formatDate, formatMoneyLocale, formatNumber } from '@/lib/format';

type PresetChoice = CapsulePreset | 'custom';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Экран «Капсулы времени» (ТЗ §4, P2): письмо себе со статистикой периода. */
export default function CapsulesPage() {
  const { t, locale } = useT();

  const [capsules, setCapsules] = useState<CapsuleSummaryDto[]>([]);
  const [details, setDetails] = useState<Record<string, CapsuleDetailDto>>({});
  const [currency, setCurrency] = useState<Currency>('RUB');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [preset, setPreset] = useState<PresetChoice>('month');
  const [customOpenAt, setCustomOpenAt] = useState('');

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [{ capsules: list }, me] = await Promise.all([capsulesApi.list(), authApi.me()]);
      setCapsules(list);
      setCurrency(me.user.currency as Currency);

      const open = list.filter((capsule) => capsule.open);
      const loaded = await Promise.all(
        open.map(async (capsule) => [capsule.id, await capsulesApi.get(capsule.id)] as const),
      );
      setDetails(Object.fromEntries(loaded));
      setError(null);
    } catch {
      setError(t('capsules.error.generic'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim() || !body.trim()) {
      setError(t('capsules.error.generic'));
      return;
    }

    let payload: CapsuleCreateInput;
    if (preset === 'custom') {
      const openAt = new Date(customOpenAt);
      if (!customOpenAt || Number.isNaN(openAt.getTime())) {
        setError(t('capsules.error.openAt'));
        return;
      }
      payload = { title: title.trim(), body, openAt: openAt.toISOString() };
    } else {
      payload = { title: title.trim(), body, preset };
    }

    setBusy(true);
    setError(null);
    try {
      await capsulesApi.create(payload);
      setTitle('');
      setBody('');
      setCustomOpenAt('');
      setNotice(t('capsules.notice.created'));
      await load();
    } catch {
      setError(t('capsules.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm(t('capsules.deleteConfirm'))) return;
    setBusy(true);
    try {
      await capsulesApi.remove(id);
      setNotice(t('capsules.notice.deleted'));
      await load();
    } catch {
      setError(t('capsules.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  const remainingDays = (openAt: string): number =>
    now === null ? 0 : Math.max(0, Math.ceil((new Date(openAt).getTime() - now) / DAY_MS));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <IconBubble name="capsule" tone="wellbeing" size={48} />
        <div>
          <h1 className="text-3xl font-extrabold">{t('capsules.title')}</h1>
          <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('capsules.subtitle')}</p>
        </div>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card className="flex flex-col gap-4">
        <form className="flex flex-col gap-3" onSubmit={(event) => void create(event)}>
          <label htmlFor="capsule-title" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('capsules.form.title')}</span>
            <input
              id="capsule-title"
              data-testid="capsule-title"
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            />
          </label>

          <label htmlFor="capsule-body-input" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('capsules.form.body')}</span>
            <textarea
              id="capsule-body-input"
              data-testid="capsule-body-input"
              value={body}
              rows={4}
              placeholder={t('capsules.form.bodyPlaceholder')}
              onChange={(event) => setBody(event.target.value)}
              className="rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3 py-2"
            />
          </label>

          <label htmlFor="capsule-preset" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {t('capsules.form.openAtLabel')}
            </span>
            <select
              id="capsule-preset"
              data-testid="capsule-preset"
              value={preset}
              onChange={(event) => setPreset(event.target.value as PresetChoice)}
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            >
              <option value="month">{t('capsules.preset.month')}</option>
              <option value="year">{t('capsules.preset.year')}</option>
              <option value="custom">{t('capsules.preset.custom')}</option>
            </select>
          </label>

          {preset === 'custom' ? (
            <label htmlFor="capsule-openat" className="flex flex-col gap-1">
              <input
                id="capsule-openat"
                data-testid="capsule-openat"
                type="datetime-local"
                value={customOpenAt}
                onChange={(event) => setCustomOpenAt(event.target.value)}
                className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
              />
              <span className="text-xs text-[var(--puls-ink-muted)]">
                {t('capsules.form.openAtHint')}
              </span>
            </label>
          ) : null}

          <PrimaryButton type="submit" data-testid="capsule-create" disabled={busy}>
            {t('capsules.create')}
          </PrimaryButton>
        </form>
      </Card>

      {capsules.length === 0 && !loading ? (
        <Card>
          <div data-testid="capsules-empty">
            <EmptyState icon="capsule" tone="wellbeing" title={t('capsules.empty')} />
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {capsules.map((capsule) => {
          const detail = details[capsule.id];
          return (
            <Card key={capsule.id} className="flex flex-col gap-3">
              <div
                data-testid="capsule-card"
                data-capsule-id={capsule.id}
                data-open={capsule.open ? 'true' : 'false'}
                className="flex items-start justify-between gap-3"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <IconBubble
                    name={capsule.open ? 'sparkle' : 'capsule'}
                    tone={capsule.open ? 'finance' : 'wellbeing'}
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate font-heading text-lg font-bold">{capsule.title}</span>
                    <span>
                      <Badge tone={capsule.open ? 'finance' : 'wellbeing'}>
                        {capsule.open ? t('capsules.opened') : t('capsules.closed')}
                      </Badge>
                    </span>
                    <span className="text-sm text-[var(--puls-ink-muted)]">
                      {t('capsules.opensAt', {
                        date: formatDate(capsule.openAt, locale, { dateStyle: 'long' }),
                      })}
                    </span>
                    {!capsule.open && now !== null ? (
                      <span
                        data-testid="capsule-countdown"
                        className="text-xs text-[var(--puls-ink-muted)]"
                      >
                        {t('capsules.remainingDays', { count: remainingDays(capsule.openAt) })}
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="capsule-delete"
                  onClick={() => void remove(capsule.id)}
                  className="shrink-0 rounded-[var(--radius-chip)] px-2 py-1 text-xs text-[var(--puls-ink-muted)] hover:bg-[var(--puls-surface-2)]"
                >
                  {t('capsules.delete')}
                </button>
              </div>

              {capsule.open && detail ? (
                <>
                  <p data-testid="capsule-letter" className="whitespace-pre-wrap text-sm">
                    {detail.body}
                  </p>

                  {detail.snapshot ? (
                    <section
                      data-testid="capsule-snapshot"
                      className="flex flex-col gap-1 rounded-[20px] bg-[var(--puls-surface-2)] p-4"
                    >
                      <h2 className="text-sm font-semibold">{t('capsules.snapshot.title')}</h2>
                      <span className="text-sm">
                        {t('capsules.snapshot.spent')}:{' '}
                        {formatMoneyLocale(detail.snapshot.spent, locale, currency)}
                      </span>
                      <span className="text-sm">
                        {t('capsules.snapshot.earned')}:{' '}
                        {formatMoneyLocale(detail.snapshot.earned, locale, currency)}
                      </span>
                      <span className="text-sm">
                        {t('capsules.snapshot.mood')}:{' '}
                        {detail.snapshot.avgMood === null
                          ? t('capsules.snapshot.noMood')
                          : formatNumber(detail.snapshot.avgMood, locale, {
                              maximumFractionDigits: 1,
                            })}
                      </span>
                      <span className="text-sm">
                        {t('capsules.snapshot.checkins')}:{' '}
                        {formatNumber(detail.snapshot.checkins, locale)}
                      </span>
                      {detail.snapshot.goals.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-sm">{t('capsules.snapshot.goals')}:</span>
                          <ul className="flex flex-col gap-1">
                            {detail.snapshot.goals.map((goal) => (
                              <li key={goal.title} className="text-xs text-[var(--puls-ink-muted)]">
                                {goal.title} — {formatNumber(goal.percent, locale)}%
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
