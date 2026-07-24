import type { ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';

// Public chrome for the sign-in / sign-up pages: a thin header (wordmark +
// theme toggle) over a centered form. Dark-first; both themes fully styled via
// DESIGN.md tokens. These pages sit outside the Fumadocs layouts, so this
// wrapper owns the page background.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-stone-50 dark:bg-zinc-900">
      <header className="flex h-14 items-center justify-between px-6">
        <BrandMark />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-16 pt-6">
        {children}
      </main>
    </div>
  );
}
