// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

/**
 * Метрики экземпляра (ТЗ v2 §8): доставки по статусам и каналам, длина
 * очереди, ошибки с запуска и время последнего тика планировщика. Только admin.
 */
import { useEffect, useState } from 'react';
import { useT } from '@/components/locale-provider';
import { Alert, Card } from '@/components/ui';
import { authApi } from '@/lib/auth-client';
import { formatDate } from '@/lib/format';
import { metricsApi, type AdminMetrics } from '@/lib/v2-client';

export default function AdminMetricsPage() {
  const { t, locale } = useT();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void authApi
      .me()
      .then((me) => setAllowed(me.user.role === 'admin'))
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void metricsApi
      .get()
      .then(setMetrics)
      .catch(() => setFailed(true));
  }, [allowed]);

  if (allowed === false) {
    return (
      <div className="flex flex-col gap-4" data-testid="metrics-page">
        <h1 className="text-3xl font-extrabold">{t('admin.metrics.title')}</h1>
        <Alert>{t('admin.metrics.forbidden')}</Alert>
      </div>
    );
  }

  const when = (iso: string | null): string =>
    iso ? formatDate(iso, locale, { dateStyle: 'short', timeStyle: 'medium' }) : '—';

  return (
    <div className="flex flex-col gap-5" data-testid="metrics-page">
      <h1 className="text-3xl font-extrabold">{t('admin.metrics.title')}</h1>
      {failed ? <Alert>{t('admin.metrics.error')}</Alert> : null}
      {metrics ? (
        <Card className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="metrics-summary">
            <dt>{t('admin.metrics.queue')}</dt>
            <dd className="font-bold">{metrics.queueLength}</dd>
            <dt>{t('admin.metrics.errors')}</dt>
            <dd className="font-bold">{metrics.errorsSinceStart}</dd>
            <dt>{t('admin.metrics.scheduler')}</dt>
            <dd className="font-bold">{when(metrics.lastSchedulerRunAt)}</dd>
            <dt>{t('admin.metrics.started')}</dt>
            <dd className="font-bold">{when(metrics.startedAt)}</dd>
          </dl>
          <h2 className="text-lg font-bold">{t('admin.metrics.deliveries')}</h2>
          <ul className="flex flex-col gap-1 text-sm" data-testid="metrics-deliveries">
            {Object.entries(metrics.deliveries.byChannel).map(([channel, counts]) => (
              <li key={channel}>
                <span className="font-semibold">{channel}</span>:{' '}
                {Object.entries(counts)
                  .map(([status, count]) => `${status} ${count}`)
                  .join(' · ')}
              </li>
            ))}
            {Object.keys(metrics.deliveries.byChannel).length === 0 ? (
              <li className="text-[var(--puls-ink-muted)]">{t('admin.metrics.noDeliveries')}</li>
            ) : null}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
