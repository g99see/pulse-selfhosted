// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { ErrorFallback } from '@/components/error-fallback';

/**
 * Граница ошибок кабинета (QA-2 D2): ошибка в странице кабинета показывается
 * внутри каркаса — пользователь остаётся в приложении и может повторить.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback digest={error.digest} reset={reset} testId="app-error" />;
}
