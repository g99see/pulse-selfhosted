// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useState } from 'react';
import type { CategoryDto, UserStoreDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { CategorySelect } from '@/components/category-select';
import { Card, PrimaryButton } from '@/components/ui';
import { financeApi } from '@/lib/finance-client';

const NAME_MAX = 120;
const PATTERN_MAX = 200;

/**
 * Диалог личного магазина (ТЗ v2 §9): название, категория деревом, необязательный
 * шаблон строки и флаг «применить ко всем похожим». Один и тот же для создания
 * (из очереди «Требует внимания») и редактирования.
 */
export function StoreDialog({
  categories,
  store = null,
  defaults,
  onClose,
  onSaved,
}: {
  categories: CategoryDto[];
  /** Существующий магазин — режим редактирования. */
  store?: UserStoreDto | null;
  /** Предзаполнение для создания (например, распознанное название). */
  defaults?: { name?: string; pattern?: string };
  onClose: () => void;
  onSaved: (result: { applied: number; created: boolean }) => void;
}) {
  const { t } = useT();
  const editing = store !== null;

  const [name, setName] = useState(store?.name ?? defaults?.name ?? '');
  const [categoryId, setCategoryId] = useState(store?.categoryId ?? '');
  const [pattern, setPattern] = useState(store?.pattern ?? defaults?.pattern ?? '');
  const [applyToSimilar, setApplyToSimilar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('finance.stores.error.name'));
      return;
    }
    if (!categoryId) {
      setError(t('finance.stores.error.category'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (editing && store) {
        await financeApi.updateStore(store.id, {
          name: trimmed,
          categoryId,
          pattern: pattern.trim(),
        });
        onSaved({ applied: 0, created: false });
      } else {
        const result = await financeApi.createStore({
          name: trimmed,
          categoryId,
          pattern: pattern.trim(),
          applyToSimilar,
        });
        onSaved({ applied: result.applied, created: true });
      }
    } catch {
      setError(t('finance.stores.error.category'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editing ? t('finance.stores.editTitle') : t('finance.stores.dialogTitle')}
      data-testid="store-dialog"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <Card className="w-full max-w-md">
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <h2 className="font-heading text-lg font-bold">
            {editing ? t('finance.stores.editTitle') : t('finance.stores.dialogTitle')}
          </h2>

          <label htmlFor="store-name" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.stores.name')}</span>
            <input
              id="store-name"
              data-testid="store-name"
              autoFocus
              value={name}
              maxLength={NAME_MAX + 1}
              onChange={(event) => setName(event.target.value)}
              className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3 outline-none focus:border-[var(--puls-primary)] focus:ring-2 focus:ring-[var(--puls-primary)]/30"
            />
          </label>

          <CategorySelect
            id="store-category"
            label={t('finance.stores.category')}
            testId="store-category"
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            emptyLabel={t('finance.category.pick')}
          />

          <label htmlFor="store-pattern" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {t('finance.stores.pattern')}
            </span>
            <input
              id="store-pattern"
              data-testid="store-pattern"
              value={pattern}
              maxLength={PATTERN_MAX + 1}
              onChange={(event) => setPattern(event.target.value)}
              className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3 outline-none focus:border-[var(--puls-primary)] focus:ring-2 focus:ring-[var(--puls-primary)]/30"
            />
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {t('finance.stores.patternHint')}
            </span>
          </label>

          {!editing ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="store-apply-similar"
                checked={applyToSimilar}
                onChange={(event) => setApplyToSimilar(event.target.checked)}
              />
              {t('finance.stores.applyToSimilar')}
            </label>
          ) : null}

          {error ? (
            <p role="alert" className="text-xs text-[var(--puls-warning-text)]">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <PrimaryButton type="submit" data-testid="store-submit" disabled={busy}>
              {editing ? t('finance.stores.save') : t('finance.stores.submit')}
            </PrimaryButton>
            <button
              type="button"
              data-testid="store-cancel"
              onClick={onClose}
              className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] px-4 text-sm font-medium"
            >
              {t('finance.stores.cancel')}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
