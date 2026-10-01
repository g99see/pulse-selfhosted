// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setupApi } from '@/lib/setup-client';

/**
 * Пока инстанс не настроен (нет ни одного пользователя), уводит с лендинга и
 * входа на мастер первого запуска (ТЗ §9 п.7, §10). Проверка на клиенте, чтобы
 * лендинг оставался статически отдаваемым, а недоступный API не ломал страницу.
 */
export function SetupGuard() {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    setupApi
      .status()
      .then((status) => {
        if (active && status.needsSetup) router.replace('/setup');
      })
      .catch(() => {
        // API недоступен — оставляем страницу как есть (она покажет свою ошибку).
      });

    return () => {
      active = false;
    };
  }, [router]);

  return null;
}
