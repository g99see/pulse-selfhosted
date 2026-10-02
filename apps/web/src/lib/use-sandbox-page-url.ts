// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { useEffect, useState } from 'react';
import { SANDBOX_ORIGINS, sandboxPageUrl } from './html-page-client';

/**
 * Адрес страницы в песочнице. Один origin — считается сразу (SSR совпадает с
 * клиентом). Несколько — выбор по протоколу/хосту страницы возможен только в
 * браузере, поэтому до монтирования возвращается null (нет рассинхрона гидрации).
 */
export function useSandboxPageUrl(sandboxUrl: string | null): string | null {
  const multi = SANDBOX_ORIGINS.length > 1;
  const [mounted, setMounted] = useState(!multi);
  useEffect(() => setMounted(true), []);
  if (sandboxUrl === null || !mounted) return null;
  return sandboxPageUrl(sandboxUrl);
}
