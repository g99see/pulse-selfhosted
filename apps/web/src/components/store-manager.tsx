// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CategoryDto, UserStoreDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Card } from '@/components/ui';
import { StoreDialog } from '@/components/store-dialog';
import { categoryLabel } from '@/lib/category-label';
import { iconGlyph } from '@/lib/category-form';
import { financeApi } from '@/lib/finance-client';

/**
 * Личные магазины пользователя (ТЗ v2 §9): список с редактированием и удалением.
 * Магазины распознаются в выписке в первую очередь — до общей базы.
 */
export function StoreManager({ categories }: { categories: CategoryDto[] }) {
  const { t } = useT();

  const [stores, setStores] = useState<UserStoreDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<UserStoreDto | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await financeApi.listStores();
      setStores(response.stores);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmDelete(id: string): Promise<void> {
    setBusy(true);
    try {
      await financeApi.removeStore(id);
      setDeleteId(null);
      setNotice('finance.stores.deleted');
      await load();
    } catch {
      setDeleteId(null);
    } finally {
      setBusy(false);
    }
  }

  const deleting = stores.find((store) => store.id === deleteId) ?? null;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-bold">{t('finance.stores.title')}</h2>
        <p className="text-xs text-[var(--puls-ink-muted)]">{t('finance.stores.hint')}</p>
      </div>

      {notice ? (
        <p role="status" className="text-sm text-[var(--puls-finance-text)]">
          {t(notice)}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2" data-testid="store-list">
        {stores.map((store) => (
          <li
            key={store.id}
            data-testid="store-item"
            className="flex items-center justify-between gap-3 rounded-[var(--radius-tile)] bg-[var(--puls-surface-2)] px-4 py-3"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base"
                style={{ backgroundColor: `${store.categoryColor}22` }}
              >
                {iconGlyph(store.categoryIcon)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{store.name}</span>
                <span className="truncate text-xs text-[var(--puls-ink-muted)]">
                  {categoryLabel({ id: store.categoryId, name: store.categoryName }, t)}
                  {' · '}
                  {store.pattern ?? t('finance.stores.noPattern')}
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                data-testid="store-edit"
                onClick={() => setEditing(store)}
                className="rounded-[var(--radius-button)] px-3 py-2 text-sm text-[var(--puls-primary-text)]"
              >
                {t('finance.stores.edit')}
              </button>
              <button
                type="button"
                data-testid="store-delete"
                onClick={() => setDeleteId(store.id)}
                aria-label={t('finance.stores.delete')}
                className="rounded-[var(--radius-button)] px-3 py-2 text-sm text-[var(--puls-warning-text)]"
              >
                ✕
              </button>
            </span>
          </li>
        ))}
        {stores.length === 0 && !loading ? (
          <li className="text-sm text-[var(--puls-ink-muted)]" data-testid="store-empty">
            {t('finance.stores.empty')}
          </li>
        ) : null}
      </ul>

      {deleting ? (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-label={t('finance.stores.delete')}
          data-testid="store-delete-confirm-panel"
          className="flex flex-col gap-2 rounded-[var(--radius-button)] border border-[var(--puls-warning)]/40 px-4 py-3"
        >
          <p className="text-sm font-medium">
            {t('finance.stores.deleteConfirm', { name: deleting.name })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="store-delete-confirm"
              autoFocus
              disabled={busy}
              onClick={() => void confirmDelete(deleting.id)}
              className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-warning)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
            >
              {t('finance.stores.delete')}
            </button>
            <button
              type="button"
              data-testid="store-delete-cancel"
              onClick={() => setDeleteId(null)}
              className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] px-4 text-sm font-medium"
            >
              {t('finance.stores.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <StoreDialog
          categories={categories}
          store={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice('finance.stores.updated');
            void load();
          }}
        />
      ) : null}
    </Card>
  );
}
