// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useState } from 'react';
import { orderCategoryTree, type CategoryDto, type CategoryKind } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { categoryLabel } from '@/lib/category-label';
import { CategorySelect } from '@/components/category-select';
import { financeApi } from '@/lib/finance-client';
import { FormToggle } from '@/components/finance-form-toggle';
import { Card, PrimaryButton } from '@/components/ui';
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  CATEGORY_NAME_MAX,
  DEFAULT_CATEGORY_COLOR,
  DEFAULT_CATEGORY_ICON,
  iconGlyph,
  isCategoryColor,
  isCategoryIcon,
  validateCategoryForm,
  type CategoryFormError,
  type CategoryFormValues,
} from '@/lib/category-form';

const ERROR_KEYS: Record<CategoryFormError, string> = {
  name_required: 'finance.categories.error.nameRequired',
  name_too_long: 'finance.categories.error.nameTooLong',
  icon_invalid: 'finance.categories.error.icon',
  color_invalid: 'finance.categories.error.color',
};

const EMPTY_FORM: CategoryFormValues = {
  name: '',
  kind: 'expense',
  icon: DEFAULT_CATEGORY_ICON,
  color: DEFAULT_CATEGORY_COLOR,
};

function formFromDto(category: CategoryDto): CategoryFormValues {
  return {
    name: category.name,
    kind: category.kind,
    icon: isCategoryIcon(category.icon) ? category.icon : DEFAULT_CATEGORY_ICON,
    color: isCategoryColor(category.color) ? category.color : DEFAULT_CATEGORY_COLOR,
  };
}

/** Поля формы категории: название, тип, иконка и цвет (ТЗ §3.2). */
function CategoryFormFields({
  values,
  errors,
  idPrefix,
  onChange,
  parentOptions,
  parentId,
  onParentChange,
}: {
  values: CategoryFormValues;
  errors: CategoryFormError[];
  idPrefix: string;
  onChange: (patch: Partial<CategoryFormValues>) => void;
  /** Свои категории для выбора родителя (без самой редактируемой). */
  parentOptions?: CategoryDto[];
  parentId?: string;
  onParentChange?: (value: string) => void;
}) {
  const { t } = useT();
  const nameId = `${idPrefix}-name`;
  const errorId = `${idPrefix}-name-error`;
  const hasNameError = errors.includes('name_required') || errors.includes('name_too_long');

  return (
    <div className="flex flex-col gap-4">
      <label htmlFor={nameId} className="flex flex-col gap-1">
        <span className="text-xs text-[var(--puls-ink-muted)]">{t('finance.categories.name')}</span>
        <input
          id={nameId}
          data-testid={nameId}
          value={values.name}
          maxLength={CATEGORY_NAME_MAX + 1}
          onChange={(event) => onChange({ name: event.target.value })}
          aria-invalid={hasNameError}
          aria-describedby={hasNameError ? errorId : undefined}
          className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3 outline-none focus:border-[var(--puls-primary)] focus:ring-2 focus:ring-[var(--puls-primary)]/30"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs text-[var(--puls-ink-muted)]">
          {t('finance.categories.kind')}
        </legend>
        <div className="flex flex-wrap gap-2">
          {(['expense', 'income'] as const satisfies readonly CategoryKind[]).map((kind) => (
            <label key={kind} className="cursor-pointer">
              <input
                type="radio"
                name={`${idPrefix}-kind`}
                value={kind}
                checked={values.kind === kind}
                onChange={() => onChange({ kind })}
                className="peer sr-only"
              />
              <span className="inline-block rounded-[var(--radius-chip)] border-[1.5px] border-[var(--puls-line-strong)] px-3 py-1.5 text-sm peer-checked:border-[var(--puls-primary)] peer-checked:bg-[var(--puls-primary)] peer-checked:text-[var(--puls-on-primary)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--puls-focus)]">
                {t(`finance.type.${kind}`)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {parentOptions ? (
        <CategorySelect
          id={`${idPrefix}-parent`}
          label={t('finance.categories.parent')}
          testId={`${idPrefix}-parent`}
          categories={parentOptions}
          value={parentId ?? ''}
          onChange={(next) => onParentChange?.(next)}
          emptyLabel={t('finance.categories.parentNone')}
        />
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs text-[var(--puls-ink-muted)]">
          {t('finance.categories.icon')}
        </legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_ICONS.map((icon) => (
            <label key={icon.name} className="cursor-pointer">
              <input
                type="radio"
                name={`${idPrefix}-icon`}
                value={icon.name}
                checked={values.icon === icon.name}
                onChange={() => onChange({ icon: icon.name })}
                aria-label={t(icon.labelKey)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="flex h-11 w-10 items-center justify-center rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] text-lg peer-checked:border-[var(--puls-primary)] peer-checked:bg-[var(--puls-primary)]/15 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--puls-focus)]"
              >
                {icon.glyph}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs text-[var(--puls-ink-muted)]">
          {t('finance.categories.color')}
        </legend>
        <div className="flex flex-wrap gap-3">
          {CATEGORY_COLORS.map((color) => (
            <label key={color.value} className="cursor-pointer">
              <input
                type="radio"
                name={`${idPrefix}-color`}
                value={color.value}
                checked={values.color === color.value}
                onChange={() => onChange({ color: color.value })}
                aria-label={t(color.labelKey)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="block h-11 w-11 rounded-full border-2 border-transparent ring-offset-2 ring-offset-[var(--puls-surface)] peer-checked:border-[var(--puls-ink)] peer-checked:ring-2 peer-checked:ring-[var(--puls-ink)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--puls-focus)]"
                style={{ backgroundColor: color.value }}
              />
            </label>
          ))}
        </div>
      </fieldset>

      {errors.length > 0 ? (
        <ul
          id={errorId}
          role="alert"
          className="flex flex-col gap-1 text-xs text-[var(--puls-warning-text)]"
        >
          {errors.map((error) => (
            <li key={error}>{t(ERROR_KEYS[error])}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Секция «Мои категории» на экране «Финансы» (ТЗ §3.2): список своих
 * категорий, создание с иконкой и цветом, переименование и удаление с
 * подтверждением. Системные категории показываются только для чтения.
 */
export function CategoryManager({
  categories,
  onChanged,
  loading = false,
}: {
  categories: CategoryDto[];
  onChanged: () => void;
  loading?: boolean;
}) {
  const { t } = useT();

  const own = categories.filter((category) => !category.isSystem);
  const system = categories.filter((category) => category.isSystem);
  const ownTree = orderCategoryTree(categories).filter((category) => !category.isSystem);

  const [createForm, setCreateForm] = useState<CategoryFormValues>(EMPTY_FORM);
  const [createParent, setCreateParent] = useState('');
  const [createErrors, setCreateErrors] = useState<CategoryFormError[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CategoryFormValues>(EMPTY_FORM);
  const [editParent, setEditParent] = useState('');
  const [editErrors, setEditErrors] = useState<CategoryFormError[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [mergeConfirm, setMergeConfirm] = useState(false);
  const [mergeError, setMergeError] = useState(false);

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setNotice(null);
    const result = validateCategoryForm(createForm);
    setCreateErrors(result.errors);
    if (!result.ok) return;

    setBusy(true);
    try {
      await financeApi.createCategory({
        ...result.values,
        ...(createParent ? { parentId: createParent } : {}),
      });
      setCreateForm(EMPTY_FORM);
      setCreateParent('');
      setCreateErrors([]);
      setNotice('finance.categories.created');
      onChanged();
    } catch {
      setCreateErrors(['name_required']);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(category: CategoryDto): void {
    setNotice(null);
    setDeleteId(null);
    setEditId(category.id);
    setEditParent(category.parentId ?? '');
    setEditErrors([]);
    setEditForm(formFromDto(category));
  }

  async function saveEdit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!editId) return;
    const result = validateCategoryForm(editForm);
    setEditErrors(result.errors);
    if (!result.ok) return;

    setBusy(true);
    try {
      await financeApi.updateCategory(editId, {
        ...result.values,
        ...(editParent ? { parentId: editParent } : {}),
      });
      setEditId(null);
      setEditErrors([]);
      setNotice('finance.categories.updated');
      onChanged();
    } catch {
      setEditErrors(['name_required']);
    } finally {
      setBusy(false);
    }
  }

  function startMerge(event: React.FormEvent): void {
    event.preventDefault();
    setNotice(null);
    if (!mergeSource || !mergeTarget || mergeSource === mergeTarget) {
      setMergeError(true);
      return;
    }
    setMergeError(false);
    setMergeConfirm(true);
  }

  async function confirmMerge(): Promise<void> {
    setBusy(true);
    try {
      await financeApi.mergeCategory(mergeSource, mergeTarget);
      setMergeConfirm(false);
      setMergeSource('');
      setMergeTarget('');
      setMergeError(false);
      setNotice('finance.categories.merged');
      onChanged();
    } catch {
      setMergeConfirm(false);
      setMergeError(true);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(id: string): Promise<void> {
    setBusy(true);
    try {
      await financeApi.removeCategory(id);
      setDeleteId(null);
      setNotice('finance.categories.deleted');
      onChanged();
    } catch {
      setDeleteId(null);
    } finally {
      setBusy(false);
    }
  }

  const deleting = own.find((category) => category.id === deleteId) ?? null;
  const mergeSourceCategory = own.find((category) => category.id === mergeSource) ?? null;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-bold">{t('finance.categories.title')}</h2>
        <p className="text-xs text-[var(--puls-ink-muted)]">{t('finance.categories.hint')}</p>
      </div>

      {notice ? (
        <p role="status" className="text-sm text-[var(--puls-finance-text)]">
          {t(notice)}
        </p>
      ) : null}

      <ul
        className="flex flex-col gap-2"
        data-testid="finance-categories"
        aria-label={t('finance.categories.listLabel')}
      >
        {ownTree.map((category) => (
          <li
            key={category.id}
            data-testid="category-item"
            style={category.depth === 1 ? { paddingLeft: '2.25rem' } : undefined}
            className="flex flex-col gap-3 rounded-[var(--radius-tile)] bg-[var(--puls-surface-2)] px-4 py-3"
          >
            {editId === category.id ? (
              <form className="flex flex-col gap-4" onSubmit={(event) => void saveEdit(event)}>
                <CategoryFormFields
                  values={editForm}
                  errors={editErrors}
                  idPrefix="category-edit"
                  onChange={(patch) => setEditForm((previous) => ({ ...previous, ...patch }))}
                  parentOptions={own.filter(
                    (category) => category.kind === editForm.kind && category.id !== editId,
                  )}
                  parentId={editParent}
                  onParentChange={setEditParent}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    data-testid="category-edit-save"
                    disabled={busy}
                    className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
                  >
                    {t('finance.categories.save')}
                  </button>
                  <button
                    type="button"
                    data-testid="category-edit-cancel"
                    onClick={() => setEditId(null)}
                    className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] px-4 text-sm font-medium"
                  >
                    {t('finance.categories.cancel')}
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 items-center justify-center rounded-full text-base"
                    style={{ backgroundColor: `${category.color}22` }}
                  >
                    {iconGlyph(category.icon)}
                  </span>
                  <span className="flex flex-col">
                    <span className="font-medium">{categoryLabel(category, t)}</span>
                    <span className="text-xs text-[var(--puls-ink-muted)]">
                      {t(`finance.type.${category.kind}`)}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="ml-1 h-3 w-3 rounded-full"
                    style={{ backgroundColor: category.color }}
                  />
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    data-testid="category-edit"
                    onClick={() => startEdit(category)}
                    aria-label={t('finance.categories.edit')}
                    className="rounded-[var(--radius-button)] px-3 py-2 text-sm text-[var(--puls-primary-text)]"
                  >
                    {t('finance.categories.edit')}
                  </button>
                  <button
                    type="button"
                    data-testid="category-delete"
                    onClick={() => setDeleteId(category.id)}
                    aria-label={t('finance.categories.delete')}
                    className="rounded-[var(--radius-button)] px-3 py-2 text-sm text-[var(--puls-warning-text)]"
                  >
                    ✕
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
        {own.length === 0 ? (
          <li className="text-sm text-[var(--puls-ink-muted)]" data-testid="categories-empty">
            {t('finance.categories.empty')}
          </li>
        ) : null}
      </ul>

      {deleting ? (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-label={t('finance.categories.delete')}
          data-testid="category-delete-confirm-panel"
          className="flex flex-col gap-2 rounded-[var(--radius-button)] border border-[var(--puls-warning)]/40 px-4 py-3"
        >
          <p className="text-sm font-medium">
            {t('finance.categories.deleteConfirm', { name: deleting.name })}
          </p>
          <p className="text-xs text-[var(--puls-ink-muted)]">
            {t('finance.categories.deleteHint')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="category-delete-confirm"
              autoFocus
              disabled={busy}
              onClick={() => void confirmDelete(deleting.id)}
              className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-warning)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
            >
              {t('finance.categories.delete')}
            </button>
            <button
              type="button"
              data-testid="category-delete-cancel"
              onClick={() => setDeleteId(null)}
              className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] px-4 text-sm font-medium"
            >
              {t('finance.categories.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {mergeConfirm ? (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-label={t('finance.categories.merge')}
          data-testid="merge-confirm-panel"
          className="flex flex-col gap-2 rounded-[var(--radius-button)] border border-[var(--puls-warning)]/40 px-4 py-3"
        >
          <p className="text-sm font-medium">
            {t('finance.categories.mergeConfirm', {
              name: mergeSourceCategory ? categoryLabel(mergeSourceCategory, t) : '',
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="merge-confirm"
              autoFocus
              disabled={busy}
              onClick={() => void confirmMerge()}
              className="h-11 rounded-[var(--radius-button)] bg-[var(--puls-warning)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
            >
              {t('finance.categories.mergeSubmit')}
            </button>
            <button
              type="button"
              data-testid="merge-cancel"
              onClick={() => setMergeConfirm(false)}
              className="h-11 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] px-4 text-sm font-medium"
            >
              {t('finance.categories.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      <FormToggle label={t('finance.categories.merge')} testId="merge-form-toggle">
        <form className="flex flex-col gap-4" onSubmit={(event) => startMerge(event)}>
          <p className="text-xs text-[var(--puls-ink-muted)]">
            {t('finance.categories.mergeHint')}
          </p>
          <CategorySelect
            id="merge-source"
            label={t('finance.categories.mergeSource')}
            testId="merge-source"
            categories={own}
            value={mergeSource}
            onChange={setMergeSource}
            emptyLabel={t('finance.category.pick')}
          />
          <CategorySelect
            id="merge-target"
            label={t('finance.categories.mergeTarget')}
            testId="merge-target"
            categories={own}
            value={mergeTarget}
            onChange={setMergeTarget}
            emptyLabel={t('finance.category.pick')}
          />
          {mergeError ? (
            <p role="alert" className="text-xs text-[var(--puls-warning-text)]">
              {t('finance.categories.mergeError')}
            </p>
          ) : null}
          <PrimaryButton
            type="submit"
            data-testid="merge-submit"
            disabled={busy || own.length < 2}
            className="self-start"
          >
            {t('finance.categories.mergeSubmit')}
          </PrimaryButton>
        </form>
      </FormToggle>

      <FormToggle label={t('finance.categories.new')} testId="category-form-toggle">
        <form className="flex flex-col gap-4" onSubmit={(event) => void create(event)}>
          <CategoryFormFields
            values={createForm}
            errors={createErrors}
            idPrefix="category"
            onChange={(patch) => setCreateForm((previous) => ({ ...previous, ...patch }))}
            parentOptions={own.filter((category) => category.kind === createForm.kind)}
            parentId={createParent}
            onParentChange={setCreateParent}
          />
          <PrimaryButton
            type="submit"
            data-testid="category-create-submit"
            disabled={busy}
            className="self-start"
          >
            {t('finance.categories.add')}
          </PrimaryButton>
        </form>
      </FormToggle>

      <div className="flex flex-col gap-2 border-t border-[var(--puls-line)] pt-4">
        <h3 className="text-sm font-semibold">{t('finance.categories.system')}</h3>
        <p className="text-xs text-[var(--puls-ink-muted)]">{t('finance.categories.systemHint')}</p>
        <ul
          className={`flex flex-wrap gap-2 ${loading ? 'min-h-32' : ''}`}
          data-testid="finance-system-categories"
          aria-label={t('finance.categories.systemListLabel')}
        >
          {system.map((category) => (
            <li
              key={category.id}
              className="flex items-center gap-1.5 rounded-[var(--radius-chip)] border border-[var(--puls-line)] px-2.5 py-1 text-xs text-[var(--puls-ink-muted)]"
            >
              <span aria-hidden="true">{iconGlyph(category.icon)}</span>
              <span>{categoryLabel(category, t)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
