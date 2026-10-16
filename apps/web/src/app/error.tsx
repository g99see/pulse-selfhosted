// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { ErrorFallback } from '@/components/error-fallback';

/**
 * Граница ошибок корневого сегмента (QA-2 D2): ошибка рендера в любой
 * странице показывает понятный экран с кнопкой повтора вместо «Application error».
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback digest={error.digest} reset={reset} testId="root-error" />;
}
