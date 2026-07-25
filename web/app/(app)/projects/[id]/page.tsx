import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageContainer } from '@/components/app/page-container';
import { ProjectHeader } from '@/components/app/project-header';
import { ProjectDocuments } from '@/components/app/project-documents';
import { StatePanel } from '@/components/app/state-panel';
import { getDocuments } from '@/lib/documents';
import { getProjects } from '@/lib/projects';
import { getTrackedRepos } from '@/lib/tracked-repos';
import type { DocumentListPage } from '@/lib/document-types';

// A project page (SPEC §16 story 6, M3.6): its description header plus its
// documents rendered with the SAME live rows as home, filtered to this project.
// The project itself is resolved from the workspace's project list — a foreign
// or unknown id simply isn't in it, so the page 404s (no existence leak, the
// same convention the API's assignment path uses). Never cached: an import in
// flight must re-read on every navigation.
export const dynamic = 'force-dynamic';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { status, projects } = await getProjects();
  // A refused read is an auth problem, not an outage — route to sign-in (the
  // home's convention), never dress it up as "API unreachable".
  if (status === 401 || status === 403) redirect('/signin');

  // An unreachable / erroring API (5xx, or a network failure surfaced as 502)
  // returns the SAME empty list as a genuinely-missing id. Distinguish them by
  // status: an outage degrades the page body (3A), it must never masquerade as a
  // 404 — only a real 200-with-absent-id below is a notFound().
  if (status !== 200) {
    return (
      <PageContainer>
        <BackLink />
        <StatePanel
          title="Couldn't load this project"
          body="The API is unreachable right now — refresh in a moment."
        />
      </PageContainer>
    );
  }

  const project = projects.find((candidate) => String(candidate.id) === id);
  // Unknown / foreign / non-numeric id: not in this workspace's set → 404. An id
  // in a URL never reveals whether a project exists elsewhere (SPEC §13).
  if (!project) notFound();

  // The project's tracked repos, so each record's state + last report renders on
  // load AND each becomes a source section (M3.10 #118). A refused/unreachable
  // read yields an empty panel + no repo sections, never a crash.
  const trackedRepos = await getTrackedRepos(project.id);
  const repos = trackedRepos.trackedRepos;
  const attachedIds = repos.map((repo) => repo.id);

  // Each section is its OWN lean, DB-paginated query (#118), server-rendered so
  // page 1 arrives already grouped and ordered: a repo section in repo-path order,
  // "Other documents" excluding the attached set. Fetched in parallel — grouping
  // costs one query per section, no more.
  const [otherRead, ...repoReads] = await Promise.all([
    getDocuments(1, project.id, attachedIds.length > 0 ? { excludeTrackedRepos: attachedIds } : undefined),
    ...repos.map((repo) => getDocuments(1, project.id, { trackedRepo: repo.id, order: 'path' })),
  ]);

  // A refused read is auth, not an outage — the home's convention.
  if (otherRead.status === 401 || otherRead.status === 403) redirect('/signin');

  const initialRepoPages: Record<number, DocumentListPage | null> = {};
  repos.forEach((repo, index) => {
    initialRepoPages[repo.id] = repoReads[index].page;
  });

  return (
    <PageContainer>
      <BackLink />

      <ProjectHeader project={project} />

      <ProjectDocuments
        project={{ id: project.id, name: project.name }}
        projects={projects}
        initialTrackedRepos={repos}
        initialRepoPages={initialRepoPages}
        initialOtherPage={otherRead.page}
      />
    </PageContainer>
  );
}

// The link back to the review queue, shared by the resolved page and its degraded
// fallback so both offer the same way out.
function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex text-sm text-emerald-600 hover:text-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400"
    >
      ← Review queue
    </Link>
  );
}
