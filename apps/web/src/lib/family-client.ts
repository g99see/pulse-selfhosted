// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API семейного режима (ТЗ §4): семья, приглашения, общие счета и цели.
 * Все запросы через authFetch — cookie-сессия + CSRF. Личный дневник сюда не
 * входит: его отдают отдельные клиенты (checkins/finance/goals).
 */
import type {
  FamilyAccountCreateValues,
  FamilyAccountDto,
  FamilyAccountUpdateInput,
  FamilyAccountsResponse,
  FamilyCreateValues,
  FamilyDto,
  FamilyGoalCreateValues,
  FamilyGoalDepositResult,
  FamilyGoalDto,
  FamilyGoalUpdateInput,
  FamilyInviteDto,
  FamilyTransactionCreateValues,
  FamilyTransactionDto,
  FamilyTransactionResult,
} from '@puls/shared';
import { authFetch } from './auth-client';

export const familyApi = {
  get: () => authFetch<{ family: FamilyDto | null }>('/api/family'),

  create: (input: FamilyCreateValues) =>
    authFetch<FamilyDto>('/api/family', { method: 'POST', body: JSON.stringify(input) }),

  remove: () => authFetch<void>('/api/family', { method: 'DELETE' }),

  invite: (expiresInHours?: number) =>
    authFetch<FamilyInviteDto>('/api/family/invites', {
      method: 'POST',
      body: JSON.stringify(expiresInHours ? { expiresInHours } : {}),
    }),

  join: (code: string) =>
    authFetch<FamilyDto>('/api/family/join', { method: 'POST', body: JSON.stringify({ code }) }),

  removeMember: (userId: string) => authFetch<void>(`/api/family/members/${userId}`, { method: 'DELETE' }),

  leave: () => authFetch<void>('/api/family/leave', { method: 'POST', body: JSON.stringify({}) }),

  accounts: () => authFetch<FamilyAccountsResponse>('/api/family/accounts'),

  createAccount: (input: FamilyAccountCreateValues) =>
    authFetch<FamilyAccountDto>('/api/family/accounts', { method: 'POST', body: JSON.stringify(input) }),

  updateAccount: (id: string, input: FamilyAccountUpdateInput) =>
    authFetch<FamilyAccountDto>(`/api/family/accounts/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

  removeAccount: (id: string) => authFetch<void>(`/api/family/accounts/${id}`, { method: 'DELETE' }),

  transactions: (accountId: string) =>
    authFetch<{ transactions: FamilyTransactionDto[] }>(`/api/family/accounts/${accountId}/transactions`),

  addTransaction: (accountId: string, input: FamilyTransactionCreateValues) =>
    authFetch<FamilyTransactionResult>(`/api/family/accounts/${accountId}/transactions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  goals: () => authFetch<{ goals: FamilyGoalDto[] }>('/api/family/goals'),

  createGoal: (input: FamilyGoalCreateValues) =>
    authFetch<FamilyGoalDto>('/api/family/goals', { method: 'POST', body: JSON.stringify(input) }),

  updateGoal: (id: string, input: FamilyGoalUpdateInput) =>
    authFetch<FamilyGoalDto>(`/api/family/goals/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

  removeGoal: (id: string) => authFetch<void>(`/api/family/goals/${id}`, { method: 'DELETE' }),

  depositGoal: (id: string, amount: number) =>
    authFetch<FamilyGoalDepositResult>(`/api/family/goals/${id}/deposit`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
};
