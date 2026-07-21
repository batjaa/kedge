import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { IntegrationsPanel } from '@/components/app/integrations-panel';
import { PageContainer } from '@/components/app/page-container';

// Workspace settings (ticket #23). M1 surface: the Integrations section, where a
// workspace connects a GitHub PAT for private-repo imports. A server component in
// the authenticated shell; the panel itself is a client island that talks to the
// API directly. DESIGN.md tokens, no webfonts.
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect('/signin'); // defensive; the layout already guards

  const { workspace } = session;

  return (
    <PageContainer>
      <div className="mb-6">
        <Link
          href="/"
          className="text-sm text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
        >
          ← Review queue
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Settings
        </h1>
        <p className="mt-1.5 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          Integrations for {workspace.name}.
        </p>
      </div>

      <IntegrationsPanel />
    </PageContainer>
  );
}
