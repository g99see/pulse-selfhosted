// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API финансов (ТЗ §3.2): категории, счета, транзакции, переводы и
 * бюджеты. Все запросы идут через authFetch — cookie-сессия + CSRF.
 */
import type {
  AccountCreateValues,
  AccountDto,
  AccountUpdateInput,
  BudgetDto,
  BudgetUpsertInput,
  CategoryCreateValues,
  CategoryDto,
  CategoryUpdateInput,
  ExchangeRateCreateValues,
  ExchangeRateDto,
  FinanceOverviewResponse,
  TransactionCreateValues,
  TransactionDto,
  TransactionKind,
  TransferCreateInput,
} from '@puls/shared';
import { authFetch } from './auth-client';

export interface AccountsResponse {
  accounts: AccountDto[];
  totalBalance: number;
  currency: string;
}

export interface TransactionsFilter {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  type?: TransactionKind;
  limit?: number;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized.length > 0 ? `?${serialized}` : '';
}

export const financeApi = {
  overview: (month?: string) =>
    authFetch<FinanceOverviewResponse & { month: string }>(
      `/api/finance/overview${query({ month })}`,
    ),

  categories: () => authFetch<{ categories: CategoryDto[] }>('/api/finance/categories'),

  createCategory: (input: CategoryCreateValues) =>
    authFetch<CategoryDto>('/api/finance/categories', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateCategory: (id: string, input: CategoryUpdateInput) =>
    authFetch<CategoryDto>(`/api/finance/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  removeCategory: (id: string) =>
    authFetch<void>(`/api/finance/categories/${id}`, { method: 'DELETE' }),

  accounts: () => authFetch<AccountsResponse>('/api/finance/accounts'),

  createAccount: (input: AccountCreateValues) =>
    authFetch<AccountDto>('/api/finance/accounts', { method: 'POST', body: JSON.stringify(input) }),

  updateAccount: (id: string, input: AccountUpdateInput) =>
    authFetch<AccountDto>(`/api/finance/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  removeAccount: (id: string) =>
    authFetch<void>(`/api/finance/accounts/${id}`, { method: 'DELETE' }),

  transactions: (filter: TransactionsFilter = {}) =>
    authFetch<{ transactions: TransactionDto[] }>(
      `/api/finance/transactions${query({ ...filter })}`,
    ),

  createTransaction: (input: TransactionCreateValues) =>
    authFetch<TransactionDto>('/api/finance/transactions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  quickTransaction: (text: string, accountId?: string) =>
    authFetch<TransactionDto>('/api/finance/transactions/quick', {
      method: 'POST',
      body: JSON.stringify({ text, accountId }),
    }),

  removeTransaction: (id: string) =>
    authFetch<void>(`/api/finance/transactions/${id}`, { method: 'DELETE' }),

  transfer: (input: TransferCreateInput) =>
    authFetch<TransactionDto>('/api/finance/transfers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  budgets: (month: string) =>
    authFetch<{ budgets: BudgetDto[]; month: string }>(`/api/finance/budgets${query({ month })}`),

  upsertBudget: (input: BudgetUpsertInput) =>
    authFetch<BudgetDto>('/api/finance/budgets', { method: 'PUT', body: JSON.stringify(input) }),

  removeBudget: (id: string) => authFetch<void>(`/api/finance/budgets/${id}`, { method: 'DELETE' }),

  /* ----- Курсы валют (ТЗ §3.2) ----- */

  rates: (filter: { date?: string; base?: string; quote?: string } = {}) =>
    authFetch<{ rates: ExchangeRateDto[] }>(`/api/finance/rates${query({ ...filter })}`),

  upsertRate: (input: ExchangeRateCreateValues) =>
    authFetch<ExchangeRateDto>('/api/finance/rates', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  removeRate: (id: string) => authFetch<void>(`/api/finance/rates/${id}`, { method: 'DELETE' }),
};

/** Событие «данные финансов изменились» — страница перечитывает сводку. */
export const FINANCE_CHANGED_EVENT = 'puls:finance-changed';

export function notifyFinanceChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(FINANCE_CHANGED_EVENT));
}
