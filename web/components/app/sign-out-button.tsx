'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { signOut } from '@/lib/auth-client';

// Ends the session, then routes to sign-in and refreshes so the server guard
// re-reads (now-cleared) auth. DESIGN.md secondary button.
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const t = useTranslations('app-shell');

  async function onClick() {
    if (pending) return;
    setPending(true);
    await signOut();
    router.replace('/signin');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-full bg-zinc-100 px-3.5 py-1.5 text-sm text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10"
    >
      {pending ? t('actions.signingOut') : t('actions.signOut')}
    </button>
  );
}
