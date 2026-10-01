// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/icons';

/** Каркас публичных экранов: пастельный фон, по центру — логотип и контент. */
export function AuthShell({
  brand,
  children,
  align = 'center',
}: {
  brand: string;
  children: ReactNode;
  align?: 'center' | 'top';
}) {
  return (
    <main id="content" className="puls-backdrop min-h-screen">
      <div
        className={`mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-5 py-10 ${
          align === 'center' ? 'justify-center' : ''
        }`}
      >
        <Link href="/" className="flex items-center gap-2.5 self-center" aria-label={brand}>
          <Logo size={36} />
          <span className="font-heading text-xl font-extrabold">{brand}</span>
        </Link>
        {children}
      </div>
    </main>
  );
}
