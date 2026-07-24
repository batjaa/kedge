import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app/app-shell';
import { PageContainer } from '@/components/app/page-container';
import { MetaChip } from '@/components/app/meta-chip';
import { Landing } from '@/components/app/landing/landing';
import { WorkspaceHome } from '@/components/app/workspace-home';
import { getDocuments } from '@/lib/documents';
import { getProjects } from '@/lib/projects';
import { getWorkspaceSummary } from '@/lib/workspace';
import { getWorkspaceActivity } from '@/lib/activity';
import { getSession } from '@/lib/session';
import { getCapabilities } from '@/lib/capabilities';
import type { Workspace } from '@/lib/auth-types';

// The root `/` — the one surface whose shape depends on who you are AND which
// edition you're on (#25). Deliberately outside the (app) route group so it
// escapes that group's authenticated guard and owns all three branches itself:
//
//   • signed in            → the review queue, in the authenticated shell
//   • anonymous + SaaS     → the instant-demo paste box (zero-signup wedge)
//   • anonymous + self-host → sign-in (self-hosted runs no public demo surface)
//
// Never cached: the branch turns on live session + edition.
export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const session = await getSession();

  if (session) {
    return (
      <AppShell user={session.user}>
        <ReviewQueue firstName={firstNameOf(session.user.name)} workspace={session.workspace} />
      </AppShell>
    );
  }

  // Anonymous. The edition decides the surface — self-hosted keeps the sign-in
  // redirect; the SaaS greets a stranger with the Open Harbor marketing landing
  // (the hero hosts the same zero-signup paste box). The edition read fails
  // closed to self-hosted (lib/capabilities), so the landing never shows on an
  // instance we can't confirm is the SaaS.
  const { selfHosted } = await getCapabilities();
  if (selfHosted) redirect('/signin');

  return <Landing />;
}

function firstNameOf(name: string): string {
  return name.split(/\s+/)[0] || name;
}

// The authenticated landing surface — the review queue's home, with the
// paste-a-URL import entry point (#17) and, under it, the workspace document
// list (SPEC 11). Page 1 is read server-side and seeds the live client island
// (WorkspaceHome), which owns submit-stays-home + per-row polling (#85); a
// failed read degrades the list area alone (the import box always renders). The
// stats strip (SPEC §16, M3.7) and the Recent-activity feed (SPEC §16, M3.8) are
// seeded the same way — each own read failing degrades that panel to nothing
// (A1), never the list. The feed loads once here with no polling (M5 owns
// liveness). Panel-based, DESIGN.md tokens.
async function ReviewQueue({
  firstName,
  workspace,
}: {
  firstName: string;
  workspace: Workspace;
}) {
  const [documents, projectsResult, summaryResult, activityResult] = await Promise.all([
    getDocuments(),
    getProjects(),
    getWorkspaceSummary(),
    getWorkspaceActivity(),
  ]);

  // A refused list read is an auth problem, not an outage: the session lapsed
  // between the /me guard and this fetch, or a workspace-less reviewer reached
  // here. Route to sign-in rather than dressing it up as "API unreachable". A
  // 5xx/network read (page === null with a 502) still degrades the list area.
  if (documents.status === 401 || documents.status === 403) redirect('/signin');

  return (
    <PageContainer>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Review queue
        </h1>
        <MetaChip>{workspace.slug}</MetaChip>
      </div>
      <p className="mt-2 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
        Welcome, {firstName}. This is {workspace.name} — your personal workspace.
      </p>

      <WorkspaceHome
        initialPage={documents.page}
        initialProjects={projectsResult.projects}
        initialProjectsDegraded={projectsResult.status !== 200}
        initialSummary={summaryResult.summary}
        initialActivity={activityResult.events}
      />
    </PageContainer>
  );
}
