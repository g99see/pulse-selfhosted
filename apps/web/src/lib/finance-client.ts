// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API финансов (ТЗ §3.2): категории, счета, транзакции, переводы и
 * бюджеты. Все запросы идут через authFetch — cookie-сессия + CSRF.
 */
import type {
  AccountCreateValues,
  AccountDto,
  AccountUpdateInput,
  BankBalanceInput,
  BudgetDto,
  BudgetUpsertInput,
  CategoryCreateValues,
  CategoryDto,
  CategoryUpdateInput,
  ExchangeRateCreateValues,
  ExchangeRateDto,
  FinanceOverviewResponse,
  MerchantEntryWithSource,
  ReconciliationResponse,
  TransactionCreateValues,
  TransactionDto,
  TransactionKind,
  TransferCreateInput,
  UnmatchedTransactionDto,
  UserStoreCreateValues,
  UserStoreDto,
  UserStoreUpdateInput,
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

  mergeCategory: (id: string, targetId: string) =>
    authFetch<CategoryDto>(`/api/finance/categories/${id}/merge`, {
      method: 'POST',
      body: JSON.stringify({ targetId }),
    }),

  /* ----- Магазины: общая база и личные (ТЗ v2 §9) ----- */

  searchMerchants: (q: string) =>
    authFetch<{ merchants: MerchantEntryWithSource[] }>(`/api/finance/merchants${query({ q })}`),

  listStores: () => authFetch<{ stores: UserStoreDto[] }>('/api/finance/stores'),

  createStore: (input: UserStoreCreateValues) =>
    authFetch<{ store: UserStoreDto; applied: number }>('/api/finance/stores', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateStore: (id: string, input: UserStoreUpdateInput) =>
    authFetch<UserStoreDto>(`/api/finance/stores/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  removeStore: (id: string) => authFetch<void>(`/api/finance/stores/${id}`, { method: 'DELETE' }),

  /** Очередь «Требует внимания»: операции без категории. */
  unmatched: (limit = 50) =>
    authFetch<{ transactions: UnmatchedTransactionDto[]; count: number }>(
      `/api/finance/unmatched${query({ limit })}`,
    ),

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

  removeAllTransactions: () =>
    authFetch<{ deleted: number }>('/api/finance/transactions/delete-all', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'DELETE' }),
    }),

  reconciliation: (accountId: string) =>
    authFetch<ReconciliationResponse>(`/api/finance/accounts/${accountId}/reconciliation`),

  setBankBalance: (accountId: string, input: BankBalanceInput) =>
    authFetch<ReconciliationResponse>(`/api/finance/accounts/${accountId}/bank-balance`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

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
