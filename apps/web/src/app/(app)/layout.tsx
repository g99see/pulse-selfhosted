// SPDX-License-Identifier: AGPL-3.0-or-later
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { MeResponse } from '@puls/shared';
import { AppShell } from '@/components/app-shell';
import { ServiceUnavailable } from '@/components/error-fallback';
import { LocaleProvider } from '@/components/locale-provider';
import { UserProvider } from '@/components/user-provider';
import { SERVER_API_URL } from '@/lib/api';
import { LOCALE_COOKIE, resolveLocale } from '@/lib/locale';

export const dynamic = 'force-dynamic';

/**
 * Защищённый каркас кабинета (ТЗ §8): без сессии — на /login,
 * без онбординга — на /onboarding.
 */
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('puls_session')?.value;
  if (!token) redirect('/login');

  // Локаль кабинета известна уже на сервере: cookie выбора → локаль профиля.
  // Иначе первый кадр рисовался бы на языке Accept-Language, а после гидратации
  // интерфейс переключался на язык профиля — весь текст перестраивался (CLS).
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;

  // API может быть недоступен (QA-2 D2): без try/catch падение запроса роняло
  // рендер и пользователь видел сырую страницу «Application error».
  let response: Response;
  try {
    response = await fetch(`${SERVER_API_URL}/api/auth/me`, {
      headers: { cookie: `puls_session=${token}` },
      cache: 'no-store',
    });
  } catch {
    return (
      <LocaleProvider initialLocale={resolveLocale({ cookie: cookieLocale })}>
        <ServiceUnavailable />
      </LocaleProvider>
    );
  }

  // 5xx — сервер жив, но сломан: показываем тот же понятный экран с повтором.
  if (response.status >= 500) {
    return (
      <LocaleProvider initialLocale={resolveLocale({ cookie: cookieLocale })}>
        <ServiceUnavailable />
      </LocaleProvider>
    );
  }

  if (!response.ok) redirect('/login');

  const me = (await response.json()) as MeResponse;
  if (!me.onboardingCompleted) redirect('/onboarding');

  const initialLocale = resolveLocale({
    cookie: cookieLocale,
    userLocale: me.user.locale,
  });

  return (
    <LocaleProvider initialLocale={initialLocale}>
      <UserProvider user={me.user}>
        <AppShell user={me.user}>{children}</AppShell>
      </UserProvider>
    </LocaleProvider>
  );
}
