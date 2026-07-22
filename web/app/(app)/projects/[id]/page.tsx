import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageContainer } from '@/components/app/page-container';
import { ProjectHeader } from '@/components/app/project-header';
import { ProjectDocuments } from '@/components/app/project-documents';
import { getDocuments } from '@/lib/documents';
import { getProjects } from '@/lib/projects';
import { getTrackedRepos } from '@/lib/tracked-repos';

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

  const project = projects.find((candidate) => String(candidate.id) === id);
  // Unknown / foreign / non-numeric id: not in this workspace's set → 404. An id
  // in a URL never reveals whether a project exists elsewhere (SPEC §13).
  if (!project) notFound();

  const documents = await getDocuments(1, project.id);
  if (documents.status === 401 || documents.status === 403) redirect('/signin');

  // The project's tracked repos, so each record's state + last report renders on
  // load (a refused/unreachable read yields an empty panel, never a crash).
  const trackedRepos = await getTrackedRepos(project.id);

  return (
    <PageContainer>
      <Link
        href="/"
        className="inline-flex text-sm text-emerald-600 hover:text-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400"
      >
        ← Review queue
      </Link>

      <ProjectHeader project={project} />

      <ProjectDocuments
        projectId={project.id}
        initialPage={documents.page}
        projects={projects}
        initialTrackedRepos={trackedRepos.trackedRepos}
      />
    </PageContainer>
  );
}
