import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app/app-shell';
import { getSession } from '@/lib/session';

// The authenticated shell for everything under (app) except the root — the
// document reading surface (#17) and beyond. Server-side guard: forwards the
// request's cookies to the API (via getSession → BFF) and, if there is no live
// session, bounces to sign-in with the originally requested path so the visitor
// returns here after authenticating. An expired cookie 401s the same way —
// never a raw error page. The root `/` is NOT in this group (#25): it is
// edition-aware (demo paste box on the SaaS), so it owns its own guard.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (!session) {
    const path = (await headers()).get('x-kedge-pathname') || '/';
    redirect(`/signin?next=${encodeURIComponent(path)}`);
  }

  return <AppShell user={session.user}>{children}</AppShell>;
}
