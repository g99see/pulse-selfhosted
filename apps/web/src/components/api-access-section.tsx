// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  API_SCOPES,
  WEBHOOK_EVENTS,
  type ApiScope,
  type ApiTokenDto,
  type WebhookDeliveryDto,
  type WebhookDto,
  type WebhookEvent,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, Card, Field, GhostButton, PrimaryButton } from '@/components/ui';
import { apiAccessApi } from '@/lib/api-access-client';

/** Переключение элемента списка выбранных значений. */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * Секция «Открытый API и вебхуки» (ТЗ §4, P2) на экране настроек: создание
 * личных токенов с однократным показом, отзыв, а также подписки на события с
 * проверкой, одноразовым показом секрета и журналом доставок.
 */
export function ApiAccessSection() {
  const { t } = useT();

  const [tokens, setTokens] = useState<ApiTokenDto[]>([]);
  const [tokenName, setTokenName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(['read']);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const [webhooks, setWebhooks] = useState<WebhookDto[]>([]);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(['transaction.created']);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, WebhookDeliveryDto[]>>({});

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [tokenList, webhookList] = await Promise.all([
        apiAccessApi.tokens(),
        apiAccessApi.webhooks(),
      ]);
      setTokens(tokenList.tokens);
      setWebhooks(webhookList.webhooks);
      setError(null);
    } catch {
      setError(t('settings.apiAccess.error'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createToken(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const created = await apiAccessApi.createToken({ name: tokenName, scopes });
      setCreatedToken(created.token);
      setTokenName('');
      await load();
    } catch {
      setError(t('settings.apiAccess.error'));
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken(id: string): Promise<void> {
    setBusy(true);
    try {
      await apiAccessApi.revokeToken(id);
      await load();
    } catch {
      setError(t('settings.apiAccess.error'));
    } finally {
      setBusy(false);
    }
  }

  async function createWebhook(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const created = await apiAccessApi.createWebhook({ url, events, enabled: true });
      setCreatedSecret(created.secret);
      setUrl('');
      await load();
    } catch {
      setError(t('settings.apiAccess.error'));
    } finally {
      setBusy(false);
    }
  }

  async function removeWebhook(id: string): Promise<void> {
    setBusy(true);
    try {
      await apiAccessApi.deleteWebhook(id);
      await load();
    } catch {
      setError(t('settings.apiAccess.error'));
    } finally {
      setBusy(false);
    }
  }

  async function testWebhook(id: string): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const result = await apiAccessApi.testWebhook(id);
      setNotice(result.ok ? t('settings.apiAccess.testOk') : t('settings.apiAccess.testFail'));
    } catch {
      setError(t('settings.apiAccess.error'));
    } finally {
      setBusy(false);
    }
  }

  async function showDeliveries(id: string): Promise<void> {
    try {
      const response = await apiAccessApi.deliveries(id);
      setDeliveries((current) => ({ ...current, [id]: response.deliveries }));
    } catch {
      setError(t('settings.apiAccess.error'));
    }
  }

  async function copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card>
      <div data-testid="api-access-section" className="flex flex-col gap-6">
        <div>
          <h2 className="font-heading text-lg font-bold">{t('settings.apiAccess.title')}</h2>
          <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('settings.apiAccess.hint')}</p>
        </div>

        {error ? <Alert>{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}

        {/* Личные токены доступа */}
        <div className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">{t('settings.apiAccess.tokensTitle')}</h3>

          <Field
            id="api-token-name"
            label={t('settings.apiAccess.tokenName')}
            placeholder={t('settings.apiAccess.tokenNamePlaceholder')}
            value={tokenName}
            onChange={(event) => setTokenName(event.target.value)}
          />

          <fieldset className="flex flex-wrap gap-4">
            {API_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  data-testid={`api-scope-${scope}`}
                  checked={scopes.includes(scope)}
                  onChange={() => setScopes((current) => toggle(current, scope))}
                />
                {t(`settings.apiAccess.scope.${scope}`)}
              </label>
            ))}
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <PrimaryButton
              type="button"
              data-testid="api-token-create"
              disabled={busy || tokenName.trim().length === 0 || scopes.length === 0}
              onClick={() => void createToken()}
            >
              {t('settings.apiAccess.createToken')}
            </PrimaryButton>
            <GhostButton type="button" disabled={busy} onClick={() => void load()}>
              {t('settings.apiAccess.refresh')}
            </GhostButton>
          </div>

          {createdToken ? (
            <div className="flex flex-col gap-2 rounded-[20px] bg-[var(--puls-surface-2)] p-4">
              <p className="text-sm font-medium">{t('settings.apiAccess.tokenOnce')}</p>
              <p data-testid="api-token-value" className="break-all font-mono text-sm">
                {createdToken}
              </p>
              <GhostButton type="button" data-testid="api-token-copy" onClick={() => void copy(createdToken)}>
                {copied ? t('settings.apiAccess.copied') : t('settings.apiAccess.copy')}
              </GhostButton>
            </div>
          ) : null}

          {tokens.length === 0 ? (
            <p data-testid="api-tokens-empty" className="text-sm text-[var(--puls-ink-muted)]">
              {t('settings.apiAccess.noTokens')}
            </p>
          ) : (
            <ul data-testid="api-token-list" className="flex flex-col gap-2">
              {tokens.map((token) => (
                <li
                  key={token.id}
                  data-testid="api-token-row"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-[var(--puls-surface-2)] p-3"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{token.name}</span>
                    <span className="font-mono text-xs text-[var(--puls-ink-muted)]">{token.prefix}…</span>
                    <span className="text-xs text-[var(--puls-ink-muted)]">
                      {t('settings.apiAccess.lastUsed')}:{' '}
                      {token.lastUsedAt
                        ? new Date(token.lastUsedAt).toLocaleString()
                        : t('settings.apiAccess.never')}
                    </span>
                  </div>
                  {token.revokedAt ? (
                    <span className="text-xs text-[var(--puls-ink-muted)]">
                      {t('settings.apiAccess.revoked')}
                    </span>
                  ) : (
                    <GhostButton
                      type="button"
                      data-testid="api-token-revoke"
                      disabled={busy}
                      onClick={() => void revokeToken(token.id)}
                    >
                      {t('settings.apiAccess.revoke')}
                    </GhostButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Вебхуки */}
        <div className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">{t('settings.apiAccess.webhooksTitle')}</h3>

          <Field
            id="webhook-url"
            label={t('settings.apiAccess.webhookUrl')}
            placeholder={t('settings.apiAccess.webhookUrlPlaceholder')}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />

          <fieldset className="flex flex-wrap gap-4">
            {WEBHOOK_EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  data-testid={`webhook-event-${event}`}
                  checked={events.includes(event)}
                  onChange={() => setEvents((current) => toggle(current, event))}
                />
                {t(`settings.apiAccess.event.${event}`)}
              </label>
            ))}
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <PrimaryButton
              type="button"
              data-testid="webhook-create"
              disabled={busy || url.trim().length === 0 || events.length === 0}
              onClick={() => void createWebhook()}
            >
              {t('settings.apiAccess.addWebhook')}
            </PrimaryButton>
          </div>

          {createdSecret ? (
            <div className="flex flex-col gap-2 rounded-[20px] bg-[var(--puls-surface-2)] p-4">
              <p className="text-sm font-medium">{t('settings.apiAccess.secretOnce')}</p>
              <p data-testid="webhook-secret" className="break-all font-mono text-sm">
                {createdSecret}
              </p>
              <GhostButton type="button" onClick={() => void copy(createdSecret)}>
                {copied ? t('settings.apiAccess.copied') : t('settings.apiAccess.copy')}
              </GhostButton>
            </div>
          ) : null}

          {webhooks.length === 0 ? (
            <p data-testid="webhooks-empty" className="text-sm text-[var(--puls-ink-muted)]">
              {t('settings.apiAccess.noWebhooks')}
            </p>
          ) : (
            <ul data-testid="webhook-list" className="flex flex-col gap-2">
              {webhooks.map((webhook) => (
                <li
                  key={webhook.id}
                  data-testid="webhook-row"
                  className="flex flex-col gap-3 rounded-[20px] bg-[var(--puls-surface-2)] p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="break-all font-mono text-sm">{webhook.url}</span>
                    <div className="flex flex-wrap gap-2">
                      <GhostButton
                        type="button"
                        data-testid="webhook-test"
                        disabled={busy}
                        onClick={() => void testWebhook(webhook.id)}
                      >
                        {t('settings.apiAccess.check')}
                      </GhostButton>
                      <GhostButton
                        type="button"
                        data-testid="webhook-deliveries"
                        onClick={() => void showDeliveries(webhook.id)}
                      >
                        {t('settings.apiAccess.deliveries')}
                      </GhostButton>
                      <GhostButton
                        type="button"
                        data-testid="webhook-delete"
                        disabled={busy}
                        onClick={() => void removeWebhook(webhook.id)}
                      >
                        {t('settings.apiAccess.delete')}
                      </GhostButton>
                    </div>
                  </div>

                  <ul className="flex flex-col gap-1 text-xs text-[var(--puls-ink-muted)]">
                    {deliveries[webhook.id]?.length ? (
                      deliveries[webhook.id]!.map((delivery) => (
                        <li key={delivery.id} data-testid="delivery-row">
                          {delivery.event} · {t(`settings.apiAccess.status.${delivery.status}`)} ·{' '}
                          {t('settings.apiAccess.attempts', { count: String(delivery.attempts) })}
                        </li>
                      ))
                    ) : (
                      <li>{t('settings.apiAccess.noDeliveries')}</li>
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
