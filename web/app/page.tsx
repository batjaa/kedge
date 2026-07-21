import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app/app-shell';
import { PageContainer } from '@/components/app/page-container';
import { DemoHome } from '@/components/app/demo-home';
import { WorkspaceHome } from '@/components/app/workspace-home';
import { getDocuments } from '@/lib/documents';
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
  // redirect; the SaaS greets a stranger with the paste box.
  const { selfHosted } = await getCapabilities();
  if (selfHosted) redirect('/signin');

  return <DemoHome />;
}

function firstNameOf(name: string): string {
  return name.split(/\s+/)[0] || name;
}

// The authenticated landing surface — the review queue's home, with the
// paste-a-URL import entry point (#17) and, under it, the workspace document
// list (SPEC 11). Page 1 is read server-side and seeds the live client island
// (WorkspaceHome), which owns submit-stays-home + per-row polling (#85); a
// failed read degrades the list area alone (the import box always renders).
// Panel-based, DESIGN.md tokens.
async function ReviewQueue({
  firstName,
  workspace,
}: {
  firstName: string;
  workspace: Workspace;
}) {
  const documents = await getDocuments();

  return (
    <PageContainer>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Review queue
        </h1>
        <span className="rounded-lg px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-zinc-500 ring-1 ring-inset ring-zinc-300 dark:text-zinc-400 dark:ring-zinc-700">
          {workspace.slug}
        </span>
      </div>
      <p className="mt-2 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
        Welcome, {firstName}. This is {workspace.name} — your personal workspace.
      </p>

      <WorkspaceHome initialPage={documents.page} />
    </PageContainer>
  );
}
