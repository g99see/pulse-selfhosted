// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

/**
 * Экран AI-помощника (ТЗ §3.9). Показывается только когда подключён ключ
 * (status.enabled); без ключа — подсказка со ссылкой в настройки. Здесь чат с
 * историей на клиенте (до 20 реплик), карточки предложений с кнопкой
 * «Применить» и разбор недели/месяца с предпросмотром того, что уйдёт
 * провайдеру (заметки и имя — только по отдельной галочке).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AiChatMessage, AiProposalDto, AiReviewPreviewDto, AiUsageDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  GhostButton,
  IconBubble,
  PrimaryButton,
  Select,
} from '@/components/ui';
import { aiApi, aiErrorKey, formatAiCost, formatAiTokens } from '@/lib/ai-client';
import { AuthApiError } from '@/lib/auth-client';

/** Экран AI-помощника: чат, предложения и разбор недели/месяца (ТЗ §3.9). */
export default function AiPage() {
  const { t, locale } = useT();

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<AiUsageDto | null>(null);

  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<AiProposalDto[]>([]);
  const [proposalBusy, setProposalBusy] = useState<string | null>(null);
  const [proposalNotice, setProposalNotice] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);

  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [includeNotes, setIncludeNotes] = useState(false);
  const [includeName, setIncludeName] = useState(false);
  const [preview, setPreview] = useState<AiReviewPreviewDto | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const messageFor = useCallback(
    (thrown: unknown, fallbackKey: string): string => {
      if (thrown instanceof AuthApiError) return t(aiErrorKey(thrown.code));
      return t(fallbackKey);
    },
    [t],
  );

  useEffect(() => {
    void aiApi
      .status()
      .then((response) => {
        setEnabled(response.status.enabled);
        setUsage(response.status.usage);
      })
      .catch(() => setEnabled(false));
  }, []);

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || chatBusy) return;
    setChatBusy(true);
    setChatError(null);
    const history = messages.slice(-20);
    try {
      const response = await aiApi.chat({ message: text, history });
      setMessages([
        ...history,
        { role: 'user', content: text },
        { role: 'assistant', content: response.reply },
      ]);
      setProposals(response.proposals);
      setUsage(response.usage);
      setInput('');
    } catch (thrown) {
      setChatError(messageFor(thrown, 'ai.chat.error'));
    } finally {
      setChatBusy(false);
    }
  }

  async function applyProposal(id: string): Promise<void> {
    setProposalBusy(id);
    setProposalNotice(null);
    setProposalError(null);
    try {
      const response = await aiApi.applyProposal(id);
      setProposals((previous) =>
        previous.map((item) => (item.id === id ? response.proposal : item)),
      );
      setProposalNotice(t('ai.proposals.applied'));
    } catch {
      setProposalError(t('ai.proposals.error'));
    } finally {
      setProposalBusy(null);
    }
  }

  function resetReview(): void {
    setPreview(null);
    setReview(null);
    setReviewError(null);
  }

  async function loadPreview(): Promise<void> {
    setPreviewBusy(true);
    setReviewError(null);
    try {
      const response = await aiApi.reviewPreview({ period, includeNotes, includeName });
      setPreview(response.preview);
    } catch (thrown) {
      setReviewError(messageFor(thrown, 'ai.review.previewError'));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function runReview(): Promise<void> {
    setReviewBusy(true);
    setReviewError(null);
    try {
      const response = await aiApi.review({ period, includeNotes, includeName });
      setReview(response.review);
      setProposals(response.proposals);
      setUsage(response.usage);
    } catch (thrown) {
      setReviewError(messageFor(thrown, 'ai.review.error'));
    } finally {
      setReviewBusy(false);
    }
  }

  if (enabled === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-extrabold">{t('ai.title')}</h1>
        <div className="min-h-40 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-6 text-sm text-[var(--puls-ink-muted)] shadow-sm">
          {t('common.loading')}
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="flex flex-col gap-4" data-testid="ai-disabled">
        <h1 className="text-3xl font-extrabold">{t('ai.title')}</h1>
        <Card>
          <EmptyState
            icon="bot"
            tone="primary"
            title={t('ai.disabled.title')}
            text={t('ai.disabled.hint')}
            action={
              <Link
                href="/settings"
                data-testid="ai-disabled-settings"
                className="inline-flex h-12 items-center rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 font-semibold text-[var(--puls-on-primary)]"
              >
                {t('ai.disabled.goSettings')}
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="ai-page">
      <div className="flex items-center gap-3">
        <IconBubble name="bot" tone="primary" size={48} />
        <div>
          <h1 className="text-3xl font-extrabold">{t('ai.title')}</h1>
          <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('ai.subtitle')}</p>
        </div>
      </div>

      {/* Чат-помощник: история хранится на клиенте и уходит в history (ТЗ §3.9). */}
      <Card className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">{t('ai.chat.title')}</h2>
        <p id="ai-chat-hint" className="text-sm text-[var(--puls-ink-muted)]">
          {t('ai.chat.hint')}
        </p>

        {chatError ? <Alert>{chatError}</Alert> : null}

        <ul
          role="log"
          aria-live="polite"
          aria-label={t('ai.chat.title')}
          data-testid="ai-chat-log"
          className="flex min-h-[8rem] max-h-[28rem] flex-col gap-3 overflow-y-auto"
        >
          {messages.length === 0 ? (
            <li className="list-none">
              <EmptyState icon="bot" tone="primary" title={t('ai.chat.empty')} />
            </li>
          ) : (
            messages.map((message, index) => (
              <li
                key={`${index}-${message.role}`}
                className={
                  message.role === 'user'
                    ? 'ml-auto max-w-[85%] rounded-[20px] rounded-br-md bg-[var(--puls-primary-soft)] px-4 py-2.5 text-sm text-[var(--puls-primary-text)]'
                    : 'mr-auto max-w-[85%] rounded-[20px] rounded-bl-md bg-[var(--puls-surface-2)] px-4 py-2.5 text-sm'
                }
              >
                <span className="mb-0.5 block text-xs font-semibold opacity-75">
                  {message.role === 'user' ? t('ai.chat.you') : t('ai.chat.assistant')}
                </span>
                {message.content}
              </li>
            ))
          )}
        </ul>

        <div className="sticky bottom-20 -mx-2 flex flex-col gap-2 rounded-[20px] bg-[var(--puls-surface)] p-2 lg:bottom-4">
          <label htmlFor="ai-chat-input" className="text-sm font-medium">
            {t('ai.chat.placeholder')}
          </label>
          <textarea
            id="ai-chat-input"
            data-testid="ai-chat-input"
            aria-describedby="ai-chat-hint"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={2}
            maxLength={2000}
            className="w-full resize-y rounded-[var(--radius-card)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] p-3 text-sm outline-none focus:border-[var(--puls-primary)]"
          />
          <div>
            <PrimaryButton
              type="button"
              data-testid="ai-chat-send"
              disabled={chatBusy || input.trim().length === 0}
              onClick={() => void send()}
            >
              {chatBusy ? t('ai.chat.sending') : t('ai.chat.send')}
            </PrimaryButton>
          </div>
        </div>
      </Card>

      {/* Предложения помощника: сохраняются только по кнопке «Применить». */}
      {proposals.length > 0 ? (
        <Card className="flex flex-col gap-3" data-testid="ai-proposals">
          <h2 className="font-heading text-lg font-bold">{t('ai.proposals.title')}</h2>
          <p className="text-sm text-[var(--puls-ink-muted)]">{t('ai.proposals.hint')}</p>
          {proposalNotice ? <Alert tone="success">{proposalNotice}</Alert> : null}
          {proposalError ? <Alert>{proposalError}</Alert> : null}
          <ul className="grid gap-3 sm:grid-cols-2">
            {proposals.map((proposal) => (
              <li
                key={proposal.id}
                data-testid="ai-proposal"
                className="flex flex-col justify-between gap-3 rounded-[20px] bg-[var(--puls-wellbeing-soft)] px-4 py-4 text-[var(--puls-ink)]"
              >
                <span className="flex flex-col text-sm">
                  <span className="mb-1 text-xs font-semibold text-[var(--puls-wellbeing-text)]">
                    {t(`ai.proposal.kind.${proposal.kind}`)}
                  </span>
                  {proposal.summary}
                </span>
                {proposal.status === 'applied' ? (
                  <span data-testid="ai-proposal-applied">
                    <Badge tone="finance">{t('ai.proposals.applied')}</Badge>
                  </span>
                ) : (
                  <PrimaryButton
                    type="button"
                    className="h-10 self-start"
                    data-testid="ai-proposal-apply"
                    disabled={proposalBusy === proposal.id}
                    onClick={() => void applyProposal(proposal.id)}
                  >
                    {proposalBusy === proposal.id
                      ? t('ai.proposals.applying')
                      : t('ai.proposals.apply')}
                  </PrimaryButton>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Разбор недели/месяца: сначала предпросмотр, потом отправка (ТЗ §3.9). */}
      <Card className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">{t('ai.review.title')}</h2>
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('ai.review.subtitle')}</p>

        <Select
          id="ai-review-period"
          label={t('ai.review.period')}
          value={period}
          onChange={(event) => {
            setPeriod(event.target.value === 'month' ? 'month' : 'week');
            resetReview();
          }}
        >
          <option value="week">{t('ai.review.period.week')}</option>
          <option value="month">{t('ai.review.period.month')}</option>
        </Select>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="ai-review-include-notes"
            checked={includeNotes}
            onChange={(event) => {
              setIncludeNotes(event.target.checked);
              resetReview();
            }}
          />
          {t('ai.review.includeNotes')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="ai-review-include-name"
            checked={includeName}
            onChange={(event) => {
              setIncludeName(event.target.checked);
              resetReview();
            }}
          />
          {t('ai.review.includeName')}
        </label>

        {reviewError ? <Alert>{reviewError}</Alert> : null}

        <div className="flex flex-wrap gap-3">
          <GhostButton
            type="button"
            data-testid="ai-review-preview"
            disabled={previewBusy}
            onClick={() => void loadPreview()}
          >
            {t('ai.review.preview')}
          </GhostButton>
          <PrimaryButton
            type="button"
            data-testid="ai-review-run"
            disabled={reviewBusy || preview === null}
            onClick={() => void runReview()}
          >
            {reviewBusy ? t('ai.review.running') : t('ai.review.run')}
          </PrimaryButton>
        </div>

        {preview ? (
          <div className="flex flex-col gap-2" data-testid="ai-review-preview-box">
            <h3 className="text-sm font-semibold">{t('ai.review.previewTitle')}</h3>
            <p data-testid="ai-review-scope" className="text-sm text-[var(--puls-ink-muted)]">
              {preview.isLocal ? t('ai.review.local') : t('ai.review.remote')}
              {preview.includesNotes ? ` · ${t('ai.review.includesNotes')}` : ''}
              {preview.includesName ? ` · ${t('ai.review.includesName')}` : ''}
            </p>
            <pre
              data-testid="ai-review-payload"
              className="max-h-72 overflow-auto whitespace-pre-wrap rounded-[20px] bg-[var(--puls-surface-2)] p-3 font-mono text-xs"
            >
              {preview.payloadText}
            </pre>
          </div>
        ) : null}

        {review ? (
          <div className="flex flex-col gap-2" data-testid="ai-review-result">
            <h3 className="text-sm font-semibold">{t('ai.review.result')}</h3>
            <p className="whitespace-pre-wrap rounded-[20px] bg-[var(--puls-surface-2)] p-3 text-sm">
              {review}
            </p>
          </div>
        ) : null}
      </Card>

      {/* Расход за месяц (ТЗ §3.9): токены, примерная стоимость и лимит. */}
      {usage ? <AiUsageCard usage={usage} locale={locale} /> : null}
    </div>
  );
}

/** Показ расхода за месяц: токены, примерная стоимость и лимит (ТЗ §3.9). */
function AiUsageCard({ usage, locale }: { usage: AiUsageDto; locale: 'ru' | 'en' }) {
  const { t } = useT();
  const tokens = usage.tokensIn + usage.tokensOut;
  return (
    <Card className="flex flex-col gap-2" data-testid="ai-usage">
      <h2 className="font-heading text-lg font-bold">{t('ai.usage.title')}</h2>
      <p className="text-xs text-[var(--puls-ink-muted)]">
        {t('ai.usage.month', { month: usage.month })}
      </p>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[var(--puls-ink-muted)]">{t('ai.usage.tokensIn')}</dt>
          <dd>{formatAiTokens(usage.tokensIn, locale)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--puls-ink-muted)]">{t('ai.usage.tokensOut')}</dt>
          <dd>{formatAiTokens(usage.tokensOut, locale)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--puls-ink-muted)]">{t('ai.usage.cost')}</dt>
          <dd>{formatAiCost(usage.costUsd)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--puls-ink-muted)]">{t('ai.usage.limit')}</dt>
          <dd>
            {usage.limitTokens === null
              ? t('ai.usage.noLimit')
              : t('ai.usage.of', {
                  used: formatAiTokens(tokens, locale),
                  limit: formatAiTokens(usage.limitTokens, locale),
                })}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
