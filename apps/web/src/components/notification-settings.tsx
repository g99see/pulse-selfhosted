// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  NOTIFICATION_TYPES,
  timesForCount,
  type BotConnectLinkResponse,
  type ChannelSettingsUpdateInput,
  type NotificationChannel,
  type NotificationChannelStatus,
  type NotificationDeliveryDto,
  type NotificationType,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, Card, GhostButton } from '@/components/ui';
import { discordApi, notificationsApi } from '@/lib/notifications-client';
import { telegramApi } from '@/lib/telegram-client';

const TYPE_LABEL_KEYS: Record<NotificationType, string> = {
  checkins: 'notifications.type.checkins',
  daily_summary: 'notifications.type.dailySummary',
  payments: 'notifications.type.payments',
  budget: 'notifications.type.budget',
  reconciliation_mismatch: 'notifications.type.reconciliation',
  weekly_report: 'notifications.type.weeklyReport',
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const COUNTS = [1, 2, 3, 4, 5, 6];
const SELECT_CLASS =
  'h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3';

function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf(
      'timeZone',
    );
  } catch {
    return ['UTC'];
  }
}

/**
 * Настройки уведомлений: карточки Telegram и Discord (привязка, включение,
 * расписание, тихие часы, пояс, типы) и журнал последних доставок. Браузер
 * разрешений на уведомления не запрашивает — всё уходит в мессенджеры.
 */
export function NotificationSettings() {
  const { t } = useT();
  const [channels, setChannels] = useState<NotificationChannelStatus[] | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationDeliveryDto[]>([]);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [channelsResponse, log] = await Promise.all([
        notificationsApi.channels(),
        notificationsApi.deliveries(),
      ]);
      setChannels(channelsResponse.channels);
      setDeliveries(log.deliveries);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div data-testid="notification-settings" className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-bold">{t('notifications.title')}</h2>
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('notifications.subtitle')}</p>
        {failed ? <Alert>{t('notifications.error')}</Alert> : null}
      </Card>

      {channels?.map((channel) => (
        <ChannelCard
          key={channel.channel}
          status={channel}
          onChanged={setChannels}
          onRelink={reload}
        />
      ))}

      <Card className="flex flex-col gap-3">
        <h3 className="font-heading text-base font-bold">{t('notifications.log.title')}</h3>
        {deliveries.length === 0 ? (
          <p data-testid="delivery-log-empty" className="text-sm text-[var(--puls-ink-muted)]">
            {t('notifications.log.empty')}
          </p>
        ) : (
          <ul data-testid="delivery-log" className="flex flex-col gap-2 text-sm">
            {deliveries.map((delivery) => (
              <li key={delivery.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {t(`notifications.channel.${delivery.channel}`)} · {delivery.type}
                </span>
                <span className="text-[var(--puls-ink-muted)]">
                  {t(`notifications.log.status.${delivery.status}`)}
                  {delivery.attempts > 1
                    ? ` · ${t('notifications.log.attempts', { count: delivery.attempts })}`
                    : ''}
                  {' · '}
                  {new Date(delivery.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ChannelCard({
  status,
  onChanged,
  onRelink,
}: {
  status: NotificationChannelStatus;
  onChanged: (channels: NotificationChannelStatus[]) => void;
  onRelink: () => Promise<void>;
}) {
  const { t } = useT();
  const channel: NotificationChannel = status.channel;
  const [link, setLink] = useState<BotConnectLinkResponse | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // Оптимистичные значения переключателей: состояние меняется сразу по клику,
  // а не после ответа сервера; при ошибке откатывается.
  const [pending, setPending] = useState<ChannelSettingsUpdateInput | null>(null);
  const enabled = pending?.enabled ?? status.enabled;
  const typeEnabled = (type: (typeof NOTIFICATION_TYPES)[number]): boolean =>
    pending?.types?.[type] ?? status.types[type] ?? false;

  async function save(input: ChannelSettingsUpdateInput): Promise<void> {
    setBusy(true);
    setPending(input);
    try {
      onChanged((await notificationsApi.updateChannel(channel, input)).channels);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  async function requestConnect(): Promise<void> {
    if (link) return;
    setBusy(true);
    try {
      setLink(await (channel === 'telegram' ? telegramApi.connect() : discordApi.connect()));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function unlink(): Promise<void> {
    setBusy(true);
    try {
      await (channel === 'telegram' ? telegramApi.unlink() : discordApi.unlink());
      setLink(null);
      await onRelink();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  // Одноразовую ссылку-подключение берём сразу, как только карточка показана
  // без привязки: тогда на кнопке уже есть готовый deep-link для пользователя
  // и для e2e-теста, который из него извлекает токен.
  useEffect(() => {
    if (!status.configured || status.linked || link) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await (channel === 'telegram'
          ? telegramApi.connect()
          : discordApi.connect());
        if (!cancelled) setLink(response);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channel, status.configured, status.linked, link]);

  // Пока ссылка жива, опрашиваем статус канала: экран сам переключится на
  // «привязан», как только пользователь подтвердит подключение в мессенджере.
  useEffect(() => {
    if (!link || status.linked || status.blocked) {
      setWaiting(false);
      return;
    }
    const expiresAt = new Date(link.expiresAt).getTime();
    const deadline = Math.min(expiresAt, Date.now() + 10 * 60 * 1000);
    setWaiting(true);
    const interval = window.setInterval(() => {
      if (Date.now() >= deadline) {
        window.clearInterval(interval);
        setWaiting(false);
        return;
      }
      void onRelink();
    }, 3000);
    const timeout = window.setTimeout(
      () => {
        window.clearInterval(interval);
        setWaiting(false);
      },
      Math.max(0, deadline - Date.now()),
    );
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      setWaiting(false);
    };
  }, [link, status.linked, status.blocked, onRelink]);

  const id = `notif-${channel}`;

  return (
    <Card>
      <div data-testid={`channel-${channel}`} className="flex flex-col gap-5">
        <div>
          <h3 className="font-heading text-lg font-bold">
            {t(`notifications.channel.${channel}`)}
          </h3>
          <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">
            {t(`notifications.channel.hint.${channel}`)}
          </p>
        </div>

        {error ? <Alert>{t('notifications.error')}</Alert> : null}

        {status.blocked ? (
          <Alert>
            <span data-testid={`${channel}-blocked`}>{t('notifications.channel.blocked')}</span>
          </Alert>
        ) : null}

        {!status.configured ? (
          <p data-testid={`${channel}-disabled`} className="text-sm text-[var(--puls-ink-muted)]">
            {t('notifications.channel.disabled')}
          </p>
        ) : null}

        {status.configured && status.linked ? (
          <div className="flex flex-col gap-3">
            <p data-testid={`${channel}-linked`} className="text-sm">
              {t('notifications.channel.linked', {
                account: status.accountLabel
                  ? `@${status.accountLabel}`
                  : t('notifications.channel.accountHidden'),
              })}
            </p>
            <GhostButton
              type="button"
              data-testid={`${channel}-unlink`}
              disabled={busy}
              onClick={() => void unlink()}
            >
              {t('notifications.channel.unlink')}
            </GhostButton>
          </div>
        ) : null}

        {status.configured && !status.linked ? (
          <div className="flex flex-col gap-3">
            <p data-testid={`${channel}-unlinked`} className="text-sm text-[var(--puls-ink-muted)]">
              {t('notifications.channel.unlinked')}
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                data-testid={`${channel}-connect`}
                href={link?.url ?? '#'}
                target="_blank"
                rel="noreferrer"
                aria-disabled={busy}
                onClick={() => void requestConnect()}
                className="puls-key inline-flex h-12 items-center rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 font-semibold text-[var(--puls-on-primary)] hover:opacity-95 aria-disabled:opacity-50"
              >
                {t('notifications.channel.connect')}
              </a>
              <GhostButton
                type="button"
                data-testid={`${channel}-refresh`}
                disabled={busy}
                onClick={() => void onRelink()}
              >
                {t('notifications.channel.refresh')}
              </GhostButton>
            </div>

            {link ? (
              <span data-testid={`${channel}-connect-url`} className="sr-only">
                {link.url}
              </span>
            ) : null}

            {link ? (
              <p className="text-xs text-[var(--puls-ink-muted)]">
                {t(`notifications.channel.connectHint.${channel}`)}
              </p>
            ) : null}

            {link && waiting ? (
              <div
                data-testid={`${channel}-connecting`}
                className="flex flex-col gap-1 rounded-[var(--radius-tile)] bg-[var(--puls-surface-2)] p-4 text-sm"
              >
                <p className="font-medium">
                  {t('notifications.channel.connecting', {
                    channel: t(`notifications.channel.${channel}`),
                  })}
                </p>
                <p className="text-[var(--puls-ink-muted)]">{t('notifications.channel.waiting')}</p>
                <p className="text-xs text-[var(--puls-ink-muted)]">
                  {t('notifications.channel.ttl', { minutes: Math.round(link.ttlSeconds / 60) })}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          <span>{t('notifications.channel.enabled')}</span>
          <input
            type="checkbox"
            role="switch"
            data-testid={`${channel}-enabled`}
            checked={enabled}
            disabled={busy}
            onChange={(event) => void save({ enabled: event.target.checked })}
          />
        </label>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">{t('notifications.types')}</legend>
          {NOTIFICATION_TYPES.map((type) => (
            <label key={type} className="flex items-center justify-between gap-3 text-sm">
              <span>{t(TYPE_LABEL_KEYS[type])}</span>
              <input
                type="checkbox"
                role="switch"
                data-testid={`${channel}-type-${type}`}
                checked={typeEnabled(type)}
                disabled={busy}
                onChange={(event) => void save({ types: { [type]: event.target.checked } })}
              />
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-3">
          <label
            htmlFor={`${id}-count`}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span>{t('notifications.checkinTimes')}</span>
            <select
              id={`${id}-count`}
              value={status.times.length}
              disabled={busy}
              onChange={(event) => void save({ times: timesForCount(Number(event.target.value)) })}
              className={SELECT_CLASS}
            >
              {COUNTS.map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>

          <label
            htmlFor={`${id}-summary`}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span>{t('notifications.summaryTime')}</span>
            <input
              id={`${id}-summary`}
              type="time"
              value={status.summaryTime}
              disabled={busy}
              onChange={(event) => {
                if (event.target.value) void save({ summaryTime: event.target.value });
              }}
              className={SELECT_CLASS}
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">{t('notifications.quietHours')}</legend>
          <div className="flex items-center gap-3">
            <label htmlFor={`${id}-quiet-start`} className="text-sm">
              {t('notifications.quietFrom')}
            </label>
            <select
              id={`${id}-quiet-start`}
              value={status.quietHours.start}
              disabled={busy}
              onChange={(event) =>
                void save({
                  quietHours: { start: Number(event.target.value), end: status.quietHours.end },
                })
              }
              className={SELECT_CLASS}
            >
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {`${String(hour).padStart(2, '0')}:00`}
                </option>
              ))}
            </select>
            <label htmlFor={`${id}-quiet-end`} className="text-sm">
              {t('notifications.quietTo')}
            </label>
            <select
              id={`${id}-quiet-end`}
              value={status.quietHours.end}
              disabled={busy}
              onChange={(event) =>
                void save({
                  quietHours: { start: status.quietHours.start, end: Number(event.target.value) },
                })
              }
              className={SELECT_CLASS}
            >
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {`${String(hour).padStart(2, '0')}:00`}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <label htmlFor={`${id}-tz`} className="flex items-center justify-between gap-3 text-sm">
          <span>{t('notifications.timezone')}</span>
          <select
            id={`${id}-tz`}
            value={status.timezone ?? ''}
            disabled={busy}
            onChange={(event) => void save({ timezone: event.target.value || null })}
            className={`${SELECT_CLASS} max-w-[14rem]`}
          >
            <option value="">{t('notifications.timezoneProfile')}</option>
            {timeZones().map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Card>
  );
}
