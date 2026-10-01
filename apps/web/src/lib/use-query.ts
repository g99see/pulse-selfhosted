// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useEffect, useState } from 'react';

/**
 * Безопасное чтение query-параметров после монтирования (без useSearchParams,
 * чтобы страницы не требовали Suspense-обёртки).
 */
export function useQueryParams(): { ready: boolean; get: (name: string) => string | null } {
  const [params, setParams] = useState<URLSearchParams | null>(null);

  useEffect(() => {
    setParams(new URLSearchParams(window.location.search));
  }, []);

  return {
    ready: params !== null,
    get: (name: string) => params?.get(name) ?? null,
  };
}
