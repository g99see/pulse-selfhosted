// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

/**
 * Админка AI (ТЗ §2, §3.9): общий ключ экземпляра, лимит токенов на
 * пользователя в месяц и расход по пользователям. Доступна только роли admin —
 * роль берём из /api/auth/me (как на странице модерации).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  AI_DEFAULT_BASE_URL,
  AI_DEFAULT_MODEL,
  AI_PROVIDERS,
  type AiInstanceSettingsInput,
  type AiProvider,
  type AiUsageAdminResponse,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, Card, EmptyState, Field, IconBubble, PrimaryButton, Select } from '@/components/ui';
import { aiApi, aiErrorKey, formatAiCost, formatAiTokens } from '@/lib/ai-client';
import { authApi, AuthApiError } from '@/lib/auth-client';

const EMPTY_PROVIDER = '';

/** Экран администрирования AI экземпляра (ТЗ §2, §3.9). */
export default function AdminAiPage() {
  const { t, locale } = useT();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [provider, setProvider] = useState<AiProvider | typeof EMPTY_PROVIDER>(EMPTY_PROVIDER);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [limit, setLimit] = useState('');
  const [last4, setLast4] = useState<string | null>(null);
  const [usage, setUsage] = useState<AiUsageAdminResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Роль из /api/auth/me: страница доступна только администратору (ТЗ §2).
  useEffect(() => {
    void authApi
      .me()
      .then((me) => setAllowed(me.user.role === 'admin'))
      .catch(() => setAllowed(false));
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [settingsResponse, usageResponse] = await Promise.all([
        aiApi.adminSettings(),
        aiApi.adminUsage(),
      ]);
      const settings = settingsResponse.settings;
      setProvider(settings.provider ?? EMPTY_PROVIDER);
      setBaseUrl(settings.baseUrl ?? '');
      setModel(settings.model ?? '');
      setLimit(settings.monthlyTokenLimit === null ? '' : String(settings.monthlyTokenLimit));
      setLast4(settings.last4);
      setUsage(usageResponse);
      setError(null);
    } catch (thrown) {
      setError(thrown instanceof AuthApiError ? t(aiErrorKey(thrown.code)) : t('ai.admin.error'));
    }
  }, [t]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  async function save(): Promise<void> {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const payload: AiInstanceSettingsInput = {
        provider: provider === EMPTY_PROVIDER ? null : provider,
        baseUrl: baseUrl.trim() ? baseUrl.trim() : null,
        model: model.trim() ? model.trim() : null,
        monthlyTokenLimit: limit.trim() ? Number(limit.trim()) : null,
      };
      // Пустое поле ключа — оставить прежний общий ключ (ТЗ §3.9).
      if (apiKey.trim()) payload.apiKey = apiKey.trim();

      const response = await aiApi.saveAdminSettings(payload);
      setLast4(response.settings.last4);
      setApiKey('');
      setNotice(t('ai.admin.saved'));
    } catch (thrown) {
      setError(thrown instanceof AuthApiError ? t(aiErrorKey(thrown.code)) : t('ai.admin.error'));
    } finally {
      setBusy(false);
    }
  }

  if (allowed === null) {
    return (
      <div className="flex flex-col gap-4" data-testid="ai-admin-page">
        <h1 className="text-3xl font-extrabold">{t('ai.admin.title')}</h1>
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('ai.admin.loading')}</p>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex flex-col gap-4" data-testid="ai-admin-page">
        <h1 className="text-3xl font-extrabold">{t('ai.admin.title')}</h1>
        <Card>
          <div data-testid="ai-admin-forbidden">
            <Alert>{t('ai.admin.forbidden')}</Alert>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="ai-admin-page">
      <div className="flex items-center gap-3">
        <IconBubble name="bot" tone="primary" size={48} />
        <div>
          <h1 className="text-3xl font-extrabold">{t('ai.admin.title')}</h1>
          <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('ai.admin.subtitle')}</p>
        </div>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      <Card className="flex flex-col gap-4">
        <h2 className="font-heading text-lg font-bold">{t('ai.admin.section')}</h2>

        {notice ? (
          <div data-testid="ai-admin-notice">
            <Alert tone="success">{notice}</Alert>
          </div>
        ) : null}

        <Select
          id="ai-admin-provider"
          label={t('ai.admin.provider')}
          value={provider}
          onChange={(event) =>
            setProvider(event.target.value as AiProvider | typeof EMPTY_PROVIDER)
          }
        >
          <option value={EMPTY_PROVIDER}>{t('ai.admin.providerNone')}</option>
          {AI_PROVIDERS.map((entry) => (
            <option key={entry} value={entry}>
              {t(`ai.key.provider.${entry}`)}
            </option>
          ))}
        </Select>
        {provider !== EMPTY_PROVIDER ? (
          <p className="-mt-2 text-xs text-[var(--puls-ink-muted)]">
            {t(`ai.key.providerHint.${provider}`)}
          </p>
        ) : null}

        <Field
          id="ai-admin-key"
          type="password"
          autoComplete="off"
          label={t('ai.admin.apiKey')}
          hint={last4 ? t('ai.key.current', { last4 }) : t('ai.admin.keepHint')}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />

        <Field
          id="ai-admin-base-url"
          type="url"
          inputMode="url"
          label={provider === 'openai_compatible' ? t('ai.admin.baseUrl') : t('ai.key.advanced')}
          hint={
            provider === 'openai_compatible'
              ? t('ai.key.baseUrlHint')
              : t('ai.key.baseUrlPresetHint')
          }
          placeholder={provider === EMPTY_PROVIDER ? '' : AI_DEFAULT_BASE_URL[provider]}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />

        <Field
          id="ai-admin-model"
          label={t('ai.admin.model')}
          hint={t('ai.key.modelHint')}
          placeholder={provider === EMPTY_PROVIDER ? '' : AI_DEFAULT_MODEL[provider]}
          value={model}
          onChange={(event) => setModel(event.target.value)}
        />

        <Field
          id="ai-admin-limit"
          type="number"
          inputMode="numeric"
          min={0}
          label={t('ai.admin.limit')}
          hint={t('ai.admin.limitHint')}
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
        />

        <div>
          <PrimaryButton
            type="button"
            data-testid="ai-admin-save"
            disabled={busy}
            onClick={() => void save()}
          >
            {t('ai.admin.save')}
          </PrimaryButton>
        </div>
      </Card>

      {/* Расход по пользователям за месяц (ТЗ §3.9). */}
      <Card className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">{t('ai.admin.usage.title')}</h2>
        {usage ? (
          <p className="text-xs text-[var(--puls-ink-muted)]">
            {t('ai.admin.usage.month', { month: usage.month })}
          </p>
        ) : null}
        {usage && usage.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table data-testid="ai-admin-usage" className="w-full text-left text-sm">
              <thead>
                <tr className="bg-[var(--puls-surface-2)] text-xs text-[var(--puls-ink-muted)]">
                  <th className="py-2 pr-3 font-medium">{t('ai.admin.usage.user')}</th>
                  <th className="py-2 pr-3 font-medium">{t('ai.admin.usage.tokens')}</th>
                  <th className="py-2 font-medium">{t('ai.admin.usage.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {usage.rows.map((row) => (
                  <tr
                    key={row.userId}
                    className="border-t border-[var(--puls-line)]"
                    data-testid="ai-admin-usage-row"
                  >
                    <td className="py-2 pr-3">@{row.nickname}</td>
                    <td className="py-2 pr-3">
                      {formatAiTokens(row.tokensIn, locale)} /{' '}
                      {formatAiTokens(row.tokensOut, locale)}
                    </td>
                    <td className="py-2">{formatAiCost(row.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div data-testid="ai-admin-usage-empty">
            <EmptyState icon="chart" tone="primary" title={t('ai.admin.usage.empty')} />
          </div>
        )}
      </Card>
    </div>
  );
}
