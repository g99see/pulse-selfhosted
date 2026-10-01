// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

/**
 * Редактор HTML-страницы профиля (ТЗ §3.8). Слева — код, справа — живой
 * предпросмотр в iframe со `sandbox="allow-scripts"` (без allow-same-origin:
 * чужие cookie и данные основного сайта недоступны). На мобильном — вкладки
 * «Код/Предпросмотр». Есть готовые шаблоны, загрузка .html, сохранение,
 * история последних 10 версий с откатом и предупреждения автопроверки из API.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  HTML_TEMPLATES,
  HTML_PAGE_MAX_BYTES,
  type HtmlCheckReason,
  type HtmlPageDto,
  type HtmlPageVersionDto,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, EmptyState, IconBubble, PrimaryButton } from '@/components/ui';
import {
  HtmlFileError,
  htmlPageApi,
  readHtmlFile,
  sandboxPageUrl,
} from '@/lib/html-page-client';

function previewPlaceholder(text: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui;color:#475569;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style></head><body>${text}</body></html>`;
}

function formatDate(value: string, locale: string): string {
  try {
    return new Date(value).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return value;
  }
}

/** Экран редактора HTML-страницы (ТЗ §3.8). */
export default function PageEditorPage() {
  const { t, locale } = useT();
  const fileRef = useRef<HTMLInputElement>(null);

  const [html, setHtml] = useState('');
  const [page, setPage] = useState<HtmlPageDto | null>(null);
  const [versions, setVersions] = useState<HtmlPageVersionDto[]>([]);
  const [tab, setTab] = useState<'code' | 'preview'>('code');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pageResponse, versionsResponse] = await Promise.all([
        htmlPageApi.get(),
        htmlPageApi.versions(),
      ]);
      setPage(pageResponse.page);
      setHtml(pageResponse.page.html ?? '');
      setVersions(versionsResponse.versions);
    } catch {
      setError(t('htmlPage.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refreshVersions(): Promise<void> {
    try {
      setVersions((await htmlPageApi.versions()).versions);
    } catch {
      // История — вспомогательная: ошибку загрузки покажет основное сообщение.
    }
  }

  function onTemplate(id: string): void {
    const template = HTML_TEMPLATES.find((item) => item.id === id);
    if (!template) return;
    setHtml(template.html);
    setNotice(t('htmlPage.template.applied', { name: template.name }));
    setTab('preview');
  }

  async function onUpload(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await readHtmlFile(file, HTML_PAGE_MAX_BYTES);
      const response = await htmlPageApi.upload(file);
      setPage(response.page);
      setHtml(response.page.html ?? '');
      await refreshVersions();
      setNotice(t('htmlPage.uploaded'));
    } catch (caught) {
      if (caught instanceof HtmlFileError && caught.code === 'too_large') {
        setError(t('htmlPage.error.tooLarge'));
      } else if (caught instanceof HtmlFileError) {
        setError(t('htmlPage.error.read'));
      } else {
        setError(t('htmlPage.error.upload'));
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onSave(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const response = await htmlPageApi.save({ html, published: true });
      setPage(response.page);
      await refreshVersions();
      setNotice(t('htmlPage.saved'));
    } catch {
      setError(t('htmlPage.error.save'));
    } finally {
      setBusy(false);
    }
  }

  async function onRestore(versionId: string): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const response = await htmlPageApi.restore(versionId);
      setPage(response.page);
      setHtml(response.page.html ?? '');
      await refreshVersions();
      setNotice(t('htmlPage.history.restored'));
    } catch {
      setError(t('htmlPage.error.save'));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(): Promise<void> {
    if (!window.confirm(t('htmlPage.deleteConfirm'))) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await htmlPageApi.remove();
      setPage(null);
      setHtml('');
      setVersions([]);
      setNotice(t('htmlPage.deleted'));
    } catch {
      setError(t('htmlPage.error.save'));
    } finally {
      setBusy(false);
    }
  }

  const reasons: HtmlCheckReason[] = page?.checkReasons ?? [];
  const publicUrl = useMemo(
    () => (page?.nickname ? sandboxPageUrl(page.sandboxUrl || `/sandbox/${page.nickname}`) : null),
    [page],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="flex items-center gap-3 text-3xl font-extrabold">
          <IconBubble name="page" tone="wellbeing" size={48} />
          {t('htmlPage.title')}
        </h1>
        {publicUrl ? (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            data-testid="htmlPage-public-link"
            className="text-sm text-[var(--puls-primary-text)] underline"
          >
            {t('htmlPage.viewer.open')}
          </a>
        ) : null}
      </div>
      <p className="-mt-2 text-sm text-[var(--puls-ink-muted)]">{t('htmlPage.subtitle')}</p>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? (
        <div data-testid="htmlPage-notice">
          <Alert tone="success">{notice}</Alert>
        </div>
      ) : null}

      {/* Шаблоны и загрузка файла. */}
      <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
        <h2 className="font-heading text-lg font-bold">{t('htmlPage.templates')}</h2>
        <div className="flex flex-wrap gap-2">
          {HTML_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              data-testid={`htmlPage-template-${template.id}`}
              onClick={() => onTemplate(template.id)}
              disabled={busy}
              title={template.description}
              className="rounded-[var(--radius-chip)] bg-[var(--puls-wellbeing-soft)] px-4 py-2 text-sm font-semibold text-[var(--puls-wellbeing-text)] transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {template.name}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('htmlPage.upload')}</span>
          <input
            ref={fileRef}
            data-testid="htmlPage-upload"
            type="file"
            accept=".html,text/html"
            onChange={(event) => void onUpload(event)}
            className="text-sm"
          />
          <span className="text-xs text-[var(--puls-ink-muted)]">{t('htmlPage.upload.hint')}</span>
        </label>
      </section>

      {/* Вкладки на мобильном (ТЗ §3.8): код слева, предпросмотр справа. */}
      <div className="flex gap-2 md:hidden" role="tablist" aria-label={t('htmlPage.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'code'}
          data-testid="htmlPage-tab-code"
          onClick={() => setTab('code')}
          className={`flex-1 rounded-[var(--radius-button)] px-4 py-2 text-sm font-semibold ${
            tab === 'code' ? 'bg-[var(--puls-primary)] text-[var(--puls-on-primary)]' : 'bg-[var(--puls-surface)] shadow-sm'
          }`}
        >
          {t('htmlPage.tab.code')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'preview'}
          data-testid="htmlPage-tab-preview"
          onClick={() => setTab('preview')}
          className={`flex-1 rounded-[var(--radius-button)] px-4 py-2 text-sm font-semibold ${
            tab === 'preview' ? 'bg-[var(--puls-primary)] text-[var(--puls-on-primary)]' : 'bg-[var(--puls-surface)] shadow-sm'
          }`}
        >
          {t('htmlPage.tab.preview')}
        </button>
      </div>

      <div className="grid gap-4 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-4 shadow-sm md:grid-cols-2">
        <section className={`flex flex-col gap-2 ${tab === 'code' ? '' : 'hidden md:flex'}`}>
          <label htmlFor="htmlPage-code" className="text-sm font-medium">
            {t('htmlPage.tab.code')}
          </label>
          <textarea
            id="htmlPage-code"
            data-testid="htmlPage-code"
            value={html}
            onChange={(event) => setHtml(event.target.value)}
            spellCheck={false}
            placeholder={t('htmlPage.empty')}
            className="h-[60vh] w-full resize-y rounded-[20px] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] p-3 font-mono text-xs leading-relaxed outline-none focus:border-[var(--puls-primary)]"
          />
        </section>

        <section className={`flex flex-col gap-2 ${tab === 'preview' ? '' : 'hidden md:flex'}`}>
          <span className="text-sm font-medium">{t('htmlPage.tab.preview')}</span>
          <iframe
            data-testid="htmlPage-preview"
            title={t('htmlPage.tab.preview')}
            srcDoc={html.trim() === '' ? previewPlaceholder(t('htmlPage.preview.placeholder')) : html}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            className="h-[60vh] w-full rounded-[20px] border border-[var(--puls-line-strong)] bg-white"
          />
          <p className="text-xs text-[var(--puls-ink-muted)]">{t('htmlPage.preview.hint')}</p>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton data-testid="htmlPage-save" onClick={() => void onSave()} disabled={busy || loading}>
          {busy ? t('htmlPage.saving') : t('htmlPage.save')}
        </PrimaryButton>
        {page?.exists ? (
          <button
            type="button"
            data-testid="htmlPage-delete"
            onClick={() => void onDelete()}
            disabled={busy}
            className="h-12 rounded-[var(--radius-button)] bg-[var(--puls-warning-soft)] px-6 text-sm font-semibold text-[var(--puls-warning-text)] disabled:opacity-50"
          >
            {t('htmlPage.delete')}
          </button>
        ) : null}
      </div>

      {/* Автопроверка (ТЗ §3.8): статус и причины из ответа API. */}
      {page && page.exists ? (
        <section
          data-testid="htmlPage-check"
          data-status={page.checkStatus}
          className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm"
        >
          <h2 className="font-heading text-lg font-bold">{t('htmlPage.check.title')}</h2>
          <p className="text-sm">
            {page.checkStatus === 'ok'
              ? t('htmlPage.check.ok')
              : page.checkStatus === 'blocked'
                ? t('htmlPage.check.blocked')
                : t('htmlPage.check.flagged')}
          </p>
          {reasons.length > 0 ? (
            <ul data-testid="htmlPage-reasons" className="list-disc pl-5 text-sm text-[var(--puls-warning-text)]">
              {reasons.map((reason) => (
                <li key={`${reason.code}-${reason.detail ?? ''}`}>
                  {reason.message}
                  {reason.detail ? `: ${reason.detail}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* История последних 10 версий с откатом (ТЗ §3.8). */}
      <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-heading text-lg font-bold">{t('htmlPage.history')}</h2>
          <span className="text-xs text-[var(--puls-ink-muted)]">{t('htmlPage.history.limit')}</span>
        </div>
        {versions.length === 0 ? (
          <div data-testid="htmlPage-history-empty">
            <EmptyState icon="page" tone="wellbeing" title={t('htmlPage.history.empty')} />
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--puls-ink-muted)]/15">
            {versions.map((version) => (
              <li
                key={version.id}
                data-testid={`htmlPage-version-${version.id}`}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span className="flex flex-col">
                  <span>{t('htmlPage.history.version', { date: formatDate(version.createdAt, locale) })}</span>
                  <span className="text-xs text-[var(--puls-ink-muted)]">
                    {version.note ? `${version.note} · ` : ''}
                    {Math.ceil(version.sizeBytes / 1024)} {t('htmlPage.history.kb')}
                  </span>
                </span>
                <button
                  type="button"
                  data-testid={`htmlPage-restore-${version.id}`}
                  onClick={() => void onRestore(version.id)}
                  disabled={busy || version.id === page?.currentVersionId}
                  className="rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--puls-primary-text)] disabled:opacity-40"
                >
                  {t('htmlPage.history.restore')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/app/profile" className="text-sm text-[var(--puls-primary-text)]">
        {t('common.back')}
      </Link>
    </div>
  );
}
