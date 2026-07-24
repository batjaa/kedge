import type { ReactNode } from 'react';
import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { HeaderNav } from '@/components/app/header-nav';
import { SignOutButton } from '@/components/app/sign-out-button';
import { SessionMonitor } from '@/components/app/session-monitor';
import type { User } from '@/lib/auth-types';

// The authenticated chrome — sticky header (brand, Documents nav, ghosted M5
// Queue chip, theme toggle, Import, identity, sign out) over a full-bleed main.
// Header anatomy tracks the locked Open Harbor mockup (docs/designs/
// app-dashboard.html) minus the ⌘K search pill and the Projects nav item —
// cross-document search is a v1 non-goal and the projects rail is the projects
// navigation (spec m3.7 Restyle decisions). Pages opt back into the centered
// column with PageContainer; the review surface uses the whole viewport
// (DESIGN.md). Extracted from the (app) route-group layout (#25) so the root
// page can render the signed-in review queue in the same shell while owning its
// own anonymous-vs-authenticated branch.
export function AppShell({
  user,
  children,
}: {
  user: User;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-stone-50 dark:bg-zinc-900">
      <SessionMonitor />
      <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b border-zinc-900/10 bg-stone-50/85 px-6 backdrop-blur dark:border-white/10 dark:bg-zinc-900/85">
        <BrandMark />
        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          <HeaderNav />
          <div
            aria-hidden="true"
            className="hidden h-5 w-px bg-zinc-900/10 lg:block dark:bg-white/15"
          />
          <ThemeToggle />
          <Link
            href="/"
            className="rounded-full bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
          >
            Import
          </Link>
          <div
            aria-hidden="true"
            className="hidden h-5 w-px bg-zinc-900/10 sm:block dark:bg-white/15"
          />
          <Link
            href="/settings"
            className="hidden rounded-md text-sm text-zinc-600 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-zinc-400 dark:hover:text-white sm:block"
          >
            Settings
          </Link>
          {/* The avatar is the persistent identity anchor and stays visible at
              every width (locked mockup); only the email label collapses on
              narrow viewports. */}
          <div className="flex items-center gap-2">
            <Avatar name={user.name} avatarUrl={user.avatar_url} />
            <span className="hidden max-w-[12rem] truncate text-sm text-zinc-600 sm:inline dark:text-zinc-400">
              {user.email}
            </span>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}

function Avatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
}) {
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={avatarUrl}
        alt=""
        className="h-7 w-7 rounded-full ring-1 ring-zinc-900/10 dark:ring-white/10"
      />
    );
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-medium text-white dark:bg-emerald-500">
      {initials || '·'}
    </span>
  );
}
