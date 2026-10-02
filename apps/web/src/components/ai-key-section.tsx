// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

/**
 * Секция «AI-помощник» на экране настроек (ТЗ §3.9): личный API-ключ
 * пользователя (приоритетнее общего ключа экземпляра). Сохранённый ключ в
 * браузер не отдаётся — показываем только последние 4 символа. Есть проверка
 * подключения, удаление ключа и расход за месяц (токены, примерная стоимость,
 * лимит).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  AI_DEFAULT_BASE_URL,
  AI_DEFAULT_MODEL,
  AI_PROVIDERS,
  type AiKeySetValues,
  type AiProvider,
  type AiStatusDto,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, Card, Field, GhostButton, PrimaryButton, Select } from '@/components/ui';
import { aiApi, aiErrorKey, aiTestErrorKey, formatAiCost, formatAiTokens } from '@/lib/ai-client';
import { AuthApiError } from '@/lib/auth-client';

/** Секция настроек личного ключа AI (ТЗ §3.9). */
export function AiKeySection() {
  const { t, locale } = useT();

  const [status, setStatus] = useState<AiStatusDto | null>(null);
  const [provider, setProvider] = useState<AiProvider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await aiApi.status();
      const next = response.status;
      setStatus(next);
      setProvider(next.provider ?? 'anthropic');
      setBaseUrl(next.baseUrl ?? '');
      setModel(next.model ?? '');
    } catch (thrown) {
      setError(thrown instanceof AuthApiError ? t(aiErrorKey(thrown.code)) : t('ai.key.error'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const needsKey = provider !== 'openai_compatible' && apiKey.trim().length === 0 && !status?.last4;
  const needsBaseUrl = provider === 'openai_compatible' && baseUrl.trim().length === 0;

  async function save(): Promise<void> {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const payload: AiKeySetValues = { provider };
      // Пустой ключ при уже сохранённом — оставляем прежний (ТЗ §3.9).
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      if (provider === 'openai_compatible') {
        payload.apiKey = apiKey.trim();
        payload.baseUrl = baseUrl.trim();
      } else if (baseUrl.trim() && baseUrl.trim() !== AI_DEFAULT_BASE_URL[provider]) {
        // Для пресетов свой адрес — только если он отличается от адреса по умолчанию.
        payload.baseUrl = baseUrl.trim();
      }
      if (model.trim()) payload.model = model.trim();

      const response = await aiApi.setKey(payload);
      setStatus(response.status);
      setApiKey('');
      setNotice(t('ai.key.saved'));
    } catch (thrown) {
      setError(thrown instanceof AuthApiError ? t(aiErrorKey(thrown.code)) : t('ai.key.error'));
    } finally {
      setBusy(false);
    }
  }

  async function test(): Promise<void> {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const response = await aiApi.testKey();
      setNotice(
        response.ok
          ? t('ai.key.testOk')
          : `${t('ai.key.testFail')} ${t(aiTestErrorKey(response.error))}`,
      );
    } catch (thrown) {
      setError(thrown instanceof AuthApiError ? t(aiErrorKey(thrown.code)) : t('ai.key.error'));
    } finally {
      setBusy(false);
    }
  }

  async function loadModels(): Promise<void> {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const response = await aiApi.models();
      setModels(response.models);
      setNotice(t('ai.key.modelsLoaded', { count: String(response.models.length) }));
    } catch {
      setError(t('ai.key.modelsFail'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm(t('ai.key.deleteConfirm'))) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await aiApi.removeKey();
      await load();
      setApiKey('');
      setNotice(t('ai.key.deleted'));
    } catch (thrown) {
      setError(thrown instanceof AuthApiError ? t(aiErrorKey(thrown.code)) : t('ai.key.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-bold">{t('ai.key.title')}</h2>
        <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('ai.key.hint')}</p>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? (
        <p
          role="status"
          data-testid="ai-key-notice"
          className="text-sm font-medium text-[var(--puls-finance-text)]"
        >
          {notice}
        </p>
      ) : null}

      {status === null ? (
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('common.loading')}</p>
      ) : (
        <>
          <Select
            id="ai-key-provider"
            label={t('ai.key.provider')}
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as AiProvider);
              setModels([]);
              setNotice(null);
            }}
          >
            {AI_PROVIDERS.map((entry) => (
              <option key={entry} value={entry}>
                {t(`ai.key.provider.${entry}`)}
              </option>
            ))}
          </Select>
          <p
            className="-mt-2 text-xs text-[var(--puls-ink-muted)]"
            data-testid="ai-key-provider-hint"
          >
            {t(`ai.key.providerHint.${provider}`)}
          </p>

          <Field
            id="ai-key-api-key"
            type="password"
            autoComplete="off"
            label={t('ai.key.apiKey')}
            hint={
              status.last4 ? t('ai.key.current', { last4: status.last4 }) : t('ai.key.apiKeyHint')
            }
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          {status.last4 ? (
            <p className="-mt-2 text-xs text-[var(--puls-ink-muted)]">{t('ai.key.keepHint')}</p>
          ) : null}

          <Field
            id="ai-key-base-url"
            type="url"
            inputMode="url"
            label={provider === 'openai_compatible' ? t('ai.key.baseUrl') : t('ai.key.advanced')}
            hint={
              provider === 'openai_compatible'
                ? t('ai.key.baseUrlHint')
                : t('ai.key.baseUrlPresetHint')
            }
            placeholder={AI_DEFAULT_BASE_URL[provider]}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />

          <Field
            id="ai-key-model"
            label={t('ai.key.model')}
            hint={t('ai.key.modelHint')}
            placeholder={AI_DEFAULT_MODEL[provider]}
            list="ai-key-models"
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
          <datalist id="ai-key-models">
            {models.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>

          <div className="flex flex-wrap gap-3">
            <PrimaryButton
              type="button"
              data-testid="ai-key-save"
              disabled={busy || needsKey || needsBaseUrl}
              onClick={() => void save()}
            >
              {t('ai.key.save')}
            </PrimaryButton>
            <GhostButton
              type="button"
              data-testid="ai-key-test"
              disabled={busy}
              onClick={() => void test()}
            >
              {t('ai.key.test')}
            </GhostButton>
            {status.last4 ? (
              <GhostButton
                type="button"
                data-testid="ai-key-models"
                disabled={busy}
                onClick={() => void loadModels()}
              >
                {t('ai.key.loadModels')}
              </GhostButton>
            ) : null}
            {status.last4 ? (
              <GhostButton
                type="button"
                data-testid="ai-key-delete"
                disabled={busy}
                onClick={() => void remove()}
              >
                {t('ai.key.delete')}
              </GhostButton>
            ) : null}
          </div>

          <dl className="grid grid-cols-2 gap-2 border-t border-[var(--puls-line)] pt-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--puls-ink-muted)]">{t('ai.usage.tokensIn')}</dt>
              <dd>{formatAiTokens(status.usage.tokensIn, locale)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--puls-ink-muted)]">{t('ai.usage.tokensOut')}</dt>
              <dd>{formatAiTokens(status.usage.tokensOut, locale)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--puls-ink-muted)]">{t('ai.usage.cost')}</dt>
              <dd>{formatAiCost(status.usage.costUsd)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--puls-ink-muted)]">{t('ai.usage.limit')}</dt>
              <dd>
                {status.usage.limitTokens === null
                  ? t('ai.usage.noLimit')
                  : formatAiTokens(status.usage.limitTokens, locale)}
              </dd>
            </div>
          </dl>
        </>
      )}
    </Card>
  );
}
