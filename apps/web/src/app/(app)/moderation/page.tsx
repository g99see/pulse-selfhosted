// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  MODERATION_ACTIONS,
  canModerate,
  type ModerationAction,
  type ModerationActionDto,
  type ReportDto,
  type ReportStatus,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, Badge, Card, EmptyState, IconBubble } from '@/components/ui';
import { authApi } from '@/lib/auth-client';
import { formatDate } from '@/lib/format';
import { moderationApi } from '@/lib/moderation-client';

/** Фильтры очереди: все либо конкретный статус (ТЗ §3.8). */
const FILTERS: Array<{ id: 'all' | ReportStatus; key: string }> = [
  { id: 'all', key: 'moderation.filter.all' },
  { id: 'open', key: 'moderation.filter.open' },
  { id: 'resolved', key: 'moderation.filter.resolved' },
  { id: 'dismissed', key: 'moderation.filter.dismissed' },
];

/**
 * Страница модерации (ТЗ §2, §3.8): очередь жалоб и журнал действий. Доступна
 * только ролям moderator и admin — роль берём из /api/auth/me.
 */
export default function ModerationPage() {
  const { t, locale } = useT();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<'all' | ReportStatus>('open');
  const [reports, setReports] = useState<ReportDto[]>([]);
  const [actions, setActions] = useState<ModerationActionDto[]>([]);
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Роль из /api/auth/me: обычный пользователь страницу не видит (ТЗ §2).
  useEffect(() => {
    void authApi
      .me()
      .then((me) => setAllowed(canModerate(me.user.role)))
      .catch(() => setAllowed(false));
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      const query = filter === 'all' ? undefined : filter;
      const [reportsResponse, actionsResponse] = await Promise.all([
        moderationApi.reports(query),
        moderationApi.actions(),
      ]);
      setReports(reportsResponse.reports);
      setActions(actionsResponse.actions);
      setError(null);
    } catch {
      setError(t('moderation.error'));
    }
  }, [filter, t]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  async function resolve(report: ReportDto, action: ModerationAction): Promise<void> {
    setBusyId(report.id);
    setMessage(null);
    try {
      await moderationApi.resolve(report.id, action, note.trim().length > 0 ? note.trim() : undefined);
      setNote('');
      setMessage(t('moderation.resolve.success'));
      await load();
    } catch {
      setError(t('moderation.resolve.error'));
    } finally {
      setBusyId(null);
    }
  }

  if (allowed === null) {
    return (
      <div className="flex flex-col gap-4" data-testid="moderation-page">
        <h1 className="text-3xl font-extrabold">{t('moderation.title')}</h1>
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('moderation.loading')}</p>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex flex-col gap-4" data-testid="moderation-page">
        <h1 className="text-3xl font-extrabold">{t('moderation.title')}</h1>
        <Card>
          <p role="alert" data-testid="moderation-forbidden" className="text-sm text-[var(--puls-warning-text)]">
            {t('moderation.forbidden')}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="moderation-page">
      <div className="flex items-center gap-3">
        <IconBubble name="shield" tone="primary" size={48} />
        <div>
          <h1 className="text-3xl font-extrabold">{t('moderation.title')}</h1>
          <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('moderation.subtitle')}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="moderation-filters">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-testid={`moderation-filter-${entry.id}`}
            aria-pressed={filter === entry.id}
            onClick={() => setFilter(entry.id)}
            className={`rounded-[var(--radius-chip)] px-4 py-1.5 text-sm font-semibold ${
              filter === entry.id
                ? 'bg-[var(--puls-primary)] text-[var(--puls-on-primary)]'
                : 'bg-[var(--puls-surface)] shadow-sm'
            }`}
          >
            {t(entry.key)}
          </button>
        ))}
      </div>

      {message ? (
        <div data-testid="moderation-message">
          <Alert tone="success">{message}</Alert>
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}

      {reports.length === 0 ? (
        <Card>
          <div data-testid="moderation-empty">
            <EmptyState icon="shield" tone="primary" title={t('moderation.empty')} />
          </div>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((report) => (
            <li key={report.id} data-testid="moderation-report">
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {t(`report.target.${report.targetType}`)} · {report.targetId}
                  </span>
                  <Badge tone={report.status === 'open' ? 'warning' : 'finance'}>
                    {t(`moderation.status.${report.status}`)}
                  </Badge>
                </div>

                <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-[var(--puls-ink-muted)]">{t('moderation.reporter')}</dt>
                    <dd>@{report.reporter.nickname}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--puls-ink-muted)]">{t('moderation.reason')}</dt>
                    <dd>{t(`report.reason.${report.reason}`)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--puls-ink-muted)]">{t('moderation.createdAt')}</dt>
                    <dd>{formatDate(report.createdAt, locale, { dateStyle: 'short', timeStyle: 'short' })}</dd>
                  </div>
                  {report.details ? (
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-[var(--puls-ink-muted)]">{t('moderation.details')}</dt>
                      <dd data-testid="moderation-report-details">{report.details}</dd>
                    </div>
                  ) : null}
                </dl>

                {report.status === 'open' ? (
                  <div className="flex flex-col gap-2">
                    <input
                      data-testid="moderation-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder={t('moderation.note')}
                      className="h-11 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      {MODERATION_ACTIONS.map((action) => (
                        <button
                          key={action}
                          type="button"
                          data-testid={`moderation-action-${action}`}
                          disabled={busyId === report.id}
                          onClick={() => void resolve(report, action)}
                          className="rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-4 py-1.5 text-sm font-semibold text-[var(--puls-primary-text)] hover:opacity-85 disabled:opacity-50"
                        >
                          {t(`moderation.action.${action}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : report.resolution ? (
                  <p className="text-sm text-[var(--puls-ink-muted)]">
                    {t('moderation.resolution')}: {report.resolution}
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">{t('moderation.actions.title')}</h2>
        {actions.length === 0 ? (
          <p data-testid="moderation-actions-empty" className="rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-4 text-sm text-[var(--puls-ink-muted)] shadow-sm">
            {t('moderation.actions.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="moderation-actions">
            {actions.map((action) => (
              <li
                key={action.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] bg-[var(--puls-surface)] px-4 py-2 text-sm"
              >
                <span>
                  {t(`moderation.action.${action.action}`)} · {t(`report.target.${action.targetType}`)} ·{' '}
                  {action.targetId}
                </span>
                <span className="text-xs text-[var(--puls-ink-muted)]">
                  @{action.moderator.nickname} · {formatDate(action.createdAt, locale, { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
