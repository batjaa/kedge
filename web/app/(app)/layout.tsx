import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BrandMark } from '@/components/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { SignOutButton } from '@/components/app/sign-out-button';
import { SessionMonitor } from '@/components/app/session-monitor';
import { getSession } from '@/lib/session';

// The authenticated shell. Server-side guard: forwards the request's cookies to
// the API (via getSession → BFF) and, if there is no live session, bounces to
// sign-in with the originally requested path so the visitor returns here after
// authenticating. An expired cookie 401s the same way — never a raw error page.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (!session) {
    const path = (await headers()).get('x-kedge-pathname') || '/';
    redirect(`/signin?next=${encodeURIComponent(path)}`);
  }

  const { user } = session;

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
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 sm:py-14">
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
