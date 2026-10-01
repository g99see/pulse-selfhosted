// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useEffect, useState } from 'react';
import {
  NOTIFICATION_TYPES,
  type NotificationRuleConfig,
  type NotificationRuleInput,
  type NotificationType,
  type VapidPublicKeyResponse,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, Card, PrimaryButton } from '@/components/ui';
import { notificationsApi } from '@/lib/notifications-client';
import { pushSupported, subscribeToPush, unsubscribeFromPush } from '@/lib/push';

const TYPE_LABEL_KEYS: Record<NotificationType, string> = {
  checkins: 'notifications.type.checkins',
  payments: 'notifications.type.payments',
  budget: 'notifications.type.budget',
  weekly_report: 'notifications.type.weeklyReport',
  reactions: 'notifications.type.reactions',
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

type PushState = 'loading' | 'unsupported' | 'server_disabled' | 'off' | 'on' | 'denied';

/** Настройки уведомлений (ТЗ §3.6): типы, тихие часы и включение web push. */
export function NotificationSettings() {
  const { t } = useT();
  const [rules, setRules] = useState<NotificationRuleConfig[] | null>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [quietStart, setQuietStart] = useState(22);
  const [quietEnd, setQuietEnd] = useState(8);
  const [vapid, setVapid] = useState<VapidPublicKeyResponse | null>(null);
  const [pushState, setPushState] = useState<PushState>('loading');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const [rulesResponse, keyResponse] = await Promise.all([
          notificationsApi.rules(),
          notificationsApi.vapidPublicKey(),
        ]);
        if (!active) return;

        setRules(rulesResponse.rules);
        setEnabled(
          Object.fromEntries(rulesResponse.rules.map((rule) => [rule.type, rule.enabled])),
        );
        const first = rulesResponse.rules[0];
        if (first) {
          setQuietStart(first.quietHours.start);
          setQuietEnd(first.quietHours.end);
        }
        setVapid(keyResponse);

        if (!pushSupported()) {
          setPushState('unsupported');
        } else if (!keyResponse.enabled) {
          setPushState('server_disabled');
        } else {
          const subscriptions = await notificationsApi.subscriptions();
          if (active) setPushState(subscriptions.subscriptions.length > 0 ? 'on' : 'off');
        }
      } catch {
        if (active) setStatus('error');
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  async function save(): Promise<void> {
    if (!rules) return;
    setStatus('saving');

    const payload: NotificationRuleInput[] = rules.map((rule) => ({
      type: rule.type,
      channel: rule.channel,
      enabled: enabled[rule.type] ?? rule.enabled,
      quietHours: { start: quietStart, end: quietEnd },
    }));

    try {
      const response = await notificationsApi.updateRules(payload);
      setRules(response.rules);
      setEnabled(Object.fromEntries(response.rules.map((rule) => [rule.type, rule.enabled])));
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  async function enablePush(): Promise<void> {
    if (!vapid?.publicKey) return;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setPushState('denied');
      return;
    }

    const subscription = await subscribeToPush(vapid.publicKey);
    if (!subscription) {
      setPushState('off');
      return;
    }

    await notificationsApi.subscribe(subscription);
    setPushState('on');
  }

  async function disablePush(): Promise<void> {
    const endpoint = await unsubscribeFromPush();
    if (endpoint) await notificationsApi.unsubscribe(endpoint);
    setPushState('off');
  }

  const pushHint =
    pushState === 'unsupported'
      ? t('notifications.pushUnsupported')
      : pushState === 'server_disabled'
        ? t('notifications.pushServerDisabled')
        : pushState === 'on'
          ? t('notifications.pushOn')
          : pushState === 'denied'
            ? t('notifications.pushDenied')
            : t('notifications.pushHint');

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="font-heading text-lg font-bold">{t('notifications.title')}</h2>
      <p className="text-sm text-[var(--puls-ink-muted)]">{t('notifications.subtitle')}</p>

      {status === 'error' ? <Alert>{t('notifications.error')}</Alert> : null}
      {status === 'saved' ? <Alert tone="success">{t('notifications.saved')}</Alert> : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">{t('notifications.types')}</legend>
        {NOTIFICATION_TYPES.map((type) => (
          <label key={type} className="flex items-center justify-between gap-3 text-sm">
            <span>{t(TYPE_LABEL_KEYS[type])}</span>
            <input
              type="checkbox"
              role="switch"
              checked={enabled[type] ?? false}
              disabled={!rules}
              onChange={(event) =>
                setEnabled((current) => ({ ...current, [type]: event.target.checked }))
              }
            />
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">{t('notifications.quietHours')}</legend>
        <div className="flex items-center gap-3">
          <label htmlFor="quiet-start" className="text-sm">
            {t('notifications.quietFrom')}
          </label>
          <select
            id="quiet-start"
            value={quietStart}
            onChange={(event) => setQuietStart(Number(event.target.value))}
            className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {`${String(hour).padStart(2, '0')}:00`}
              </option>
            ))}
          </select>

          <label htmlFor="quiet-end" className="text-sm">
            {t('notifications.quietTo')}
          </label>
          <select
            id="quiet-end"
            value={quietEnd}
            onChange={(event) => setQuietEnd(Number(event.target.value))}
            className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {`${String(hour).padStart(2, '0')}:00`}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <PrimaryButton
          type="button"
          onClick={() => void save()}
          disabled={!rules || status === 'saving'}
        >
          {t('notifications.save')}
        </PrimaryButton>

        {pushState === 'on' ? (
          <button
            type="button"
            onClick={() => void disablePush()}
            className="h-12 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] px-6 font-semibold"
          >
            {t('notifications.pushDisable')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void enablePush()}
            disabled={pushState !== 'off'}
            className="h-12 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] px-6 font-semibold disabled:opacity-50"
          >
            {t('notifications.pushEnable')}
          </button>
        )}

        <p className="text-xs text-[var(--puls-ink-muted)]">{pushHint}</p>
      </div>
    </Card>
  );
}
