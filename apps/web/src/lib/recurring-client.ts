// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API регулярных платежей (ТЗ §3.2): CRUD, пауза/возобновление и
 * ближайшие списания. Все запросы идут через authFetch — cookie + CSRF.
 */
import type {
  RecurringPaymentCreateValues,
  RecurringPaymentDto,
  RecurringPaymentListResponse,
  RecurringPaymentUpdateInput,
  RecurringUpcomingResponse,
} from '@puls/shared';
import { authFetch } from './auth-client';

export const recurringApi = {
  list: () => authFetch<RecurringPaymentListResponse>('/api/finance/recurring-payments'),

  upcoming: () => authFetch<RecurringUpcomingResponse>('/api/finance/recurring-payments/upcoming'),

  create: (input: RecurringPaymentCreateValues) =>
    authFetch<RecurringPaymentDto>('/api/finance/recurring-payments', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  update: (id: string, input: RecurringPaymentUpdateInput) =>
    authFetch<RecurringPaymentDto>(`/api/finance/recurring-payments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  setActive: (id: string, active: boolean) =>
    authFetch<RecurringPaymentDto>(`/api/finance/recurring-payments/${id}/active`, {
      method: 'PUT',
      body: JSON.stringify({ active }),
    }),

  remove: (id: string) =>
    authFetch<void>(`/api/finance/recurring-payments/${id}`, { method: 'DELETE' }),
};

/** Следующая дата списания для формы (1–31) с учётом прижатия к концу месяца. */
export function isRecurrenceFrequency(value: string): value is 'weekly' | 'monthly' | 'yearly' {
  return value === 'weekly' || value === 'monthly' || value === 'yearly';
}
