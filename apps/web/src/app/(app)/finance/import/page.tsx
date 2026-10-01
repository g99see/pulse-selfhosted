// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AccountDto, ImportColumnMapping, ImportColumn } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, Card, IconBubble, PrimaryButton } from '@/components/ui';
import { formatNumber } from '@/lib/format';
import { financeApi, notifyFinanceChanged } from '@/lib/finance-client';
import {
  ImportFileError,
  importApi,
  readStatementFile,
  type ImportCommitResponse,
  type ImportPreviewResponse,
  type StatementEncoding,
} from '@/lib/import-client';

/** Роли колонок для ручного сопоставления (ТЗ §3.2). */
const MAPPING_FIELDS: Array<{ column: ImportColumn; key: string }> = [
  { column: 'date', key: 'finance.import.column.date' },
  { column: 'amount', key: 'finance.import.column.amount' },
  { column: 'description', key: 'finance.import.column.description' },
  { column: 'type', key: 'finance.import.column.type' },
  { column: 'debit', key: 'finance.import.column.debit' },
  { column: 'credit', key: 'finance.import.column.credit' },
];

const PREVIEW_LIMIT = 100;

/** Экран импорта выписки (ТЗ §3.2): загрузка CSV, предпросмотр, сопоставление, импорт. */
export default function ImportPage() {
  const { t, locale } = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [encoding, setEncoding] = useState<StatementEncoding | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportCommitResponse | null>(null);

  useEffect(() => {
    void financeApi.accounts().then((response) => {
      setAccounts(response.accounts);
      setAccountId((current) => current || response.accounts[0]?.id || '');
    });
  }, []);

  const runPreview = useCallback(
    async (text: string, options: { mapping?: ImportColumnMapping; hasHeader?: boolean } = {}) => {
      setBusy(true);
      setError(null);
      try {
        const response = await importApi.preview({
          csv: text,
          hasHeader: options.hasHeader ?? true,
          mapping: options.mapping,
        });
        setPreview(response);
        setHasHeader(response.hasHeader);
      } catch {
        setError(t('finance.import.error.parse'));
        setPreview(null);
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setResult(null);
    try {
      const decoded = await readStatementFile(file);
      setFileName(file.name);
      setEncoding(decoded.encoding);
      setCsv(decoded.text);
      await runPreview(decoded.text, { hasHeader: true });
    } catch (caught) {
      setPreview(null);
      setCsv(null);
      setError(
        caught instanceof ImportFileError && caught.code === 'too_large'
          ? t('finance.import.error.tooLarge')
          : t('finance.import.error.parse'),
      );
    }
  }

  async function onMappingChange(column: ImportColumn, value: string): Promise<void> {
    if (!csv || !preview) return;
    const mapping: ImportColumnMapping = { ...preview.mapping };
    if (value === '') delete mapping[column];
    else mapping[column] = Number(value);
    await runPreview(csv, { mapping, hasHeader });
  }

  async function onHeaderToggle(next: boolean): Promise<void> {
    setHasHeader(next);
    if (csv) await runPreview(csv, { hasHeader: next });
  }

  async function onCommit(): Promise<void> {
    if (!csv || !accountId) {
      setError(t('finance.import.error.account'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await importApi.commit({
        csv,
        accountId,
        hasHeader,
        mapping: preview?.mapping,
      });
      setResult(response);
      notifyFinanceChanged();
      if (inputRef.current) inputRef.current.value = '';
      setPreview(null);
      setCsv(null);
      setFileName(null);
    } catch {
      setError(t('finance.import.error.commit'));
    } finally {
      setBusy(false);
    }
  }

  const rows = preview?.rows.slice(0, PREVIEW_LIMIT) ?? [];

  function mappingLabel(index: number): string {
    const header = preview?.headers[index];
    return header && header.trim() !== '' ? header : `#${index + 1}`;
  }

  function statusKey(row: (typeof rows)[number]): string {
    if (row.error) return 'finance.import.status.error';
    if (row.duplicate) return 'finance.import.status.duplicate';
    return 'finance.import.status.ok';
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconBubble name="inbox" tone="finance" size={48} />
          <h1 className="font-heading text-3xl font-extrabold">{t('finance.import.title')}</h1>
        </div>
        <Link
          href="/finance"
          className="inline-flex h-10 items-center rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-4 text-sm font-semibold text-[var(--puls-primary-text)]"
        >
          {t('common.back')}
        </Link>
      </div>
      <p className="text-sm text-[var(--puls-ink-muted)]">{t('finance.import.subtitle')}</p>

      {error ? (
        <div data-testid="import-error">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      <Card className="flex flex-col gap-3">
        <label htmlFor="import-file" className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('finance.import.file')}</span>
          <input
            id="import-file"
            data-testid="import-file"
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void onFileChange(event)}
            className="rounded-[20px] border-2 border-dashed border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] p-5 text-sm"
          />
        </label>

        {fileName ? (
          <p className="text-xs text-[var(--puls-ink-muted)]" data-testid="import-file-meta">
            {t('finance.import.encoding', { encoding: encoding ?? '' })}
            {preview
              ? ` · ${t('finance.import.delimiter', { delimiter: preview.delimiter === '\t' ? 'TAB' : preview.delimiter })}`
              : ''}
          </p>
        ) : null}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="import-has-header"
            checked={hasHeader}
            onChange={(event) => void onHeaderToggle(event.target.checked)}
          />
          {t('finance.import.header')}
        </label>
      </Card>

      {preview ? (
        <>
          <Card className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold">{t('finance.import.mapping')}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {MAPPING_FIELDS.map((field) => (
                <label key={field.column} className="flex flex-col gap-1">
                  <span className="text-xs text-[var(--puls-ink-muted)]">{t(field.key)}</span>
                  <select
                    data-testid={`import-mapping-${field.column}`}
                    value={preview.mapping[field.column] ?? ''}
                    onChange={(event) => void onMappingChange(field.column, event.target.value)}
                    className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
                  >
                    <option value="">{t('finance.import.column.none')}</option>
                    {preview.headers.map((_, index) => (
                      <option key={index} value={index}>
                        {mappingLabel(index)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="text-sm text-[var(--puls-ink-muted)]" data-testid="import-summary">
              {t('finance.import.summary', {
                total: preview.summary.total,
                valid: preview.summary.valid,
                duplicates: preview.summary.duplicates,
                errors: preview.summary.errors,
              })}
            </p>
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold">{t('finance.import.preview')}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="import-preview-table">
                <thead className="text-xs text-[var(--puls-ink-muted)]">
                  <tr>
                    <th className="py-1 pr-3">{t('finance.import.col.row')}</th>
                    <th className="py-1 pr-3">{t('finance.import.col.date')}</th>
                    <th className="py-1 pr-3">{t('finance.import.col.amount')}</th>
                    <th className="py-1 pr-3">{t('finance.import.col.type')}</th>
                    <th className="py-1 pr-3">{t('finance.import.col.description')}</th>
                    <th className="py-1 pr-3">{t('finance.import.col.category')}</th>
                    <th className="py-1">{t('finance.import.col.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.rowNumber} className="border-t border-[var(--puls-line)]">
                      <td className="py-1 pr-3 text-[var(--puls-ink-muted)]">{row.rowNumber}</td>
                      <td className="py-1 pr-3">{row.date ?? '—'}</td>
                      <td className="py-1 pr-3 [font-variant-numeric:tabular-nums]">
                        {row.amount === null
                          ? '—'
                          : formatNumber(row.amount, locale, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-1 pr-3">
                        {row.type ? t(`finance.type.${row.type}`) : '—'}
                      </td>
                      <td className="py-1 pr-3">{row.description || '—'}</td>
                      <td className="py-1 pr-3">{row.categoryName ?? '—'}</td>
                      <td className="py-1">{t(statusKey(row))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > PREVIEW_LIMIT ? (
              <p className="text-xs text-[var(--puls-ink-muted)]" data-testid="import-preview-more">
                {t('finance.import.showing', { shown: PREVIEW_LIMIT, total: preview.rows.length })}
              </p>
            ) : null}
          </Card>

          <Card className="flex flex-wrap items-end gap-3">
            <label htmlFor="import-account" className="flex flex-1 flex-col gap-1">
              <span className="text-sm font-medium">{t('finance.import.account')}</span>
              <select
                id="import-account"
                data-testid="import-account"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <PrimaryButton
              type="button"
              data-testid="import-confirm"
              disabled={busy || preview.summary.valid === 0}
              onClick={() => void onCommit()}
            >
              {busy ? t('finance.import.committing') : t('finance.import.confirm')}
            </PrimaryButton>
          </Card>
        </>
      ) : null}

      {result ? (
        <div
          data-testid="import-result"
          role="status"
          className="rounded-[var(--radius-button)] bg-[var(--puls-finance-soft)] px-4 py-3 text-sm text-[var(--puls-finance-text)]"
        >
          {t('finance.import.result', {
            imported: result.imported,
            duplicates: result.duplicates,
            invalid: result.invalid,
            balance: formatNumber(result.balance, locale, { maximumFractionDigits: 2 }),
          })}
        </div>
      ) : null}
    </div>
  );
}
