import type { ReactNode } from 'react';
import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { SignOutButton } from '@/components/app/sign-out-button';
import { SessionMonitor } from '@/components/app/session-monitor';
import type { User } from '@/lib/auth-types';

// The authenticated chrome — sticky header (wordmark, theme toggle, identity,
// sign out) over a full-bleed main. Pages opt back into the centered column
// with PageContainer; the review surface uses the whole viewport (DESIGN.md).
// Extracted from the (app) route-group layout (#25) so the root page can
// render the signed-in review queue in the same shell while owning its own
// anonymous-vs-authenticated branch.
export function AppShell({
  user,
  children,
}: {
  user: User;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-900">
      <SessionMonitor />
      <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b border-zinc-900/10 bg-white/85 px-6 backdrop-blur dark:border-white/10 dark:bg-zinc-900/85">
        <BrandMark />
        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/settings"
            className="hidden text-sm text-zinc-600 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-zinc-400 dark:hover:text-white sm:block"
          >
            Settings
          </Link>
          <ThemeToggle />
          <div className="hidden items-center gap-2 sm:flex">
            <Avatar name={user.name} avatarUrl={user.avatar_url} />
            <span className="max-w-[16rem] truncate text-sm text-zinc-600 dark:text-zinc-400">
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
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-medium text-white">
      {initials || '·'}
    </span>
  );
}
