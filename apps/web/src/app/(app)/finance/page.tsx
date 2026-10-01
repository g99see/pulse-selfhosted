// SPDX-License-Identifier: AGPL-3.0-or-later
import { cookies } from 'next/headers';
import { Suspense } from 'react';
import { monthKey, type FinanceOverviewResponse } from '@puls/shared';
import { SERVER_API_URL } from '@/lib/api';
import { FinanceScreen } from './finance-screen';

/**
 * Финансы: сводку счетов (общий баланс — крупнейший элемент экрана, LCP) берём на
 * сервере, чтобы она была в первом HTML. Без этого баланс появлялся только после
 * загрузки JS и запроса из браузера — Lighthouse Performance падал ниже 90.
 * Ошибка здесь не фатальна: экран сам перезапросит данные на клиенте.
 */
async function loadOverview(): Promise<FinanceOverviewResponse | null> {
  const token = (await cookies()).get('puls_session')?.value;
  if (!token) return null;
  try {
    const response = await fetch(
      `${SERVER_API_URL}/api/finance/overview?month=${monthKey(new Date())}`,
      { headers: { cookie: `puls_session=${token}` }, cache: 'no-store' },
    );
    return response.ok ? ((await response.json()) as FinanceOverviewResponse) : null;
  } catch {
    return null;
  }
}

export default async function FinancePage() {
  const initialOverview = await loadOverview();
  return (
    <Suspense fallback={<div className="min-h-96" />}>
      <FinanceScreen initialOverview={initialOverview} />
    </Suspense>
  );
}
