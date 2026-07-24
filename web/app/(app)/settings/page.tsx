import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { IntegrationsPanel } from '@/components/app/integrations-panel';
import { WorkspaceGeneralCard } from '@/components/app/workspace-general-card';
import { MetaChip } from '@/components/app/meta-chip';
import { PageContainer } from '@/components/app/page-container';

// Workspace settings. General (rename/slug, M3.7 decision 11A) sits above
// Integrations (the GitHub PAT surface, #23). A server component in the
// authenticated shell; each card is a client island that talks to the API
// directly. The workspace name is rendered from the session here, so a rename
// (which calls router.refresh) shows in this chrome without a full reload.
// Open Harbor register, DESIGN.md tokens, no webfonts.
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
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
            Workspace settings
          </h1>
          <MetaChip>Personal</MetaChip>
        </div>
        <p className="mt-1.5 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          Managing{' '}
          <span className="font-medium text-zinc-900 dark:text-white">{workspace.name}</span> — your
          personal workspace.
        </p>
      </div>

      <div className="space-y-6">
        <WorkspaceGeneralCard workspace={workspace} />
        <IntegrationsPanel />
      </div>
    </PageContainer>
  );
}
