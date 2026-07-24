'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The header's primary nav — Documents (the workspace home) and a ghosted Queue
// chip that marks the M5 review-queue roadmap slot in-product (honest ghosting,
// not a dead link). Client-side because "active" depends on the current route:
// AppShell wraps every (app) surface, so Documents must announce itself as the
// current page only on the dashboard. No Projects item — the projects rail is
// the projects navigation (spec m3.7 Restyle decisions). Hidden below lg like
// the locked mockup.
export function HeaderNav() {
  const pathname = usePathname();
  const onDashboard = pathname === '/';

  return (
    <nav aria-label="Primary" className="hidden items-center gap-5 text-sm lg:flex">
      <Link
        href="/"
        aria-current={onDashboard ? 'page' : undefined}
        className={
          onDashboard
            ? 'rounded-md font-medium text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-white'
            : 'rounded-md text-zinc-500 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:text-white'
        }
      >
        Documents
      </Link>
      <span
        className="flex cursor-default items-center gap-1.5 text-zinc-400 dark:text-zinc-600"
        title="Review queue arrives with M5"
      >
        Queue
        <span className="rounded-lg bg-zinc-400/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-zinc-400 ring-1 ring-inset ring-zinc-400/30 dark:text-zinc-500">
          M5
        </span>
      </span>
    </nav>
  );
}
