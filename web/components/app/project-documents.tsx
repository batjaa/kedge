'use client';

import { useCallback, useMemo, useState } from 'react';
import { ImportForm } from './import-form';
import { DocumentSection, type SectionInjection } from './document-section';
import { TrackedRepoPanel } from './tracked-repo-panel';
import { toListItem } from '@/lib/document-list-live';
import { reportImportingRows, type TrackedRepo } from '@/lib/tracked-repo-scan';
import {
  OTHER_SECTION,
  repoShortName,
  resolveSectionKey,
  type SectionKey,
} from '@/lib/project-sections';
import type { Document, DocumentListPage, Project, ProjectRef } from '@/lib/document-types';

// A project page's document surface (SPEC §11, M3.10 #118) — grouped by SOURCE.
// Each attached tracked repo becomes a section headed by its short name
// (`owner/repo`), its docs in repo-path order; everything not from an attached
// repo (hand/paste imports, docs reassigned in from another project) reads under
// "Other documents", newest-first as before. Each section is its own
// server-paginated live list (DocumentSection), so grouping costs one DB query
// per section and never hides a document.
//
// This component is the orchestrator: it owns the tracked-repo list (so a repo
// tracked or removed here adds/removes its section live) and routes freshly-
// imported rows into the right section — a scan's queued imports into their
// repo's section, a paste into Other — each settling through the existing per-row
// path. The import box files into this project, so a paste lands under Other.

/** An empty page for a repo tracked live this session (no server-rendered page). */
const EMPTY_PAGE: DocumentListPage = {
  data: [],
  meta: { current_page: 1, last_page: 1, per_page: 20, total: 0 },
};

export function ProjectDocuments({
  project,
  projects,
  initialTrackedRepos = [],
  initialRepoPages = {},
  initialOtherPage,
}: {
  /** This page's project — scopes the list and stamps scan-materialized rows. */
  project: ProjectRef;
  projects: Project[];
  initialTrackedRepos?: TrackedRepo[];
  /** Server-rendered page 1 per attached repo id (null = a degraded read). */
  initialRepoPages?: Record<number, DocumentListPage | null>;
  /** Server-rendered page 1 for "Other documents" (the exclude-attached read). */
  initialOtherPage: DocumentListPage | null;
}) {
  const projectId = project.id;
  const [repos, setRepos] = useState<TrackedRepo[]>(initialTrackedRepos);
  // Per-section injection batches (keyed by section: repo id or 'other'), each a
  // monotonic {seq, rows} the target section applies once. Bumping the seq is how
  // a scan/paste hands rows to a section without a cross-island imperative call.
  const [injections, setInjections] = useState<Record<string, SectionInjection>>({});

  const attachedIds = useMemo(() => new Set(repos.map((repo) => repo.id)), [repos]);
  // Repo sections in a stable order (attachment order by id) so they never
  // reshuffle as scans settle or repos are added.
  const orderedRepos = useMemo(() => [...repos].sort((a, b) => a.id - b.id), [repos]);
  // The Other section excludes exactly the attached set; its identity is stable
  // per attached-id set so its Load more stays scoped.
  const excludeIds = useMemo(() => [...attachedIds].sort((a, b) => a - b), [attachedIds]);

  const injectInto = useCallback((key: SectionKey, rows: SectionInjection['rows']) => {
    if (rows.length === 0) return;
    setInjections((prev) => {
      const id = String(key);
      const seq = (prev[id]?.seq ?? 0) + 1;
      return { ...prev, [id]: { seq, rows } };
    });
  }, []);

  // A settled scan's queued imports materialize into their repo's section (story
  // 22, now source-scoped): the report names the repo, so they route to its
  // section and settle there — never Other. Stamped with this page's project so
  // the row's project chip reads correctly (B1).
  const handleScanSettled = useCallback(
    (repo: TrackedRepo) => {
      const rows = reportImportingRows(repo.last_scan_report, project);
      // The scanning repo is attached (it lives in this panel), so this resolves to
      // its own section; the resolve is the defensive guard for a just-removed repo.
      injectInto(resolveSectionKey(repo.id, attachedIds), rows);
    },
    [project, attachedIds, injectInto],
  );

  // A hand/paste import from the box: no tracked repo, so it lands under Other
  // (resolveSectionKey maps a null repo id there) and settles live in place.
  const handleImported = useCallback(
    (doc: Document) => {
      injectInto(resolveSectionKey(doc.tracked_repo_id, attachedIds), [toListItem(doc)]);
    },
    [attachedIds, injectInto],
  );

  const hasRepos = orderedRepos.length > 0;

  return (
    <>
      <TrackedRepoPanel
        project={project}
        repos={repos}
        setRepos={setRepos}
        onScanSettled={handleScanSettled}
      />

      <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-8">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
          Import into this project
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Paste a link or content and it lands here, filed under this project.
        </p>
        <ImportForm onImported={handleImported} projectId={projectId} />
      </div>

      {/* One section per attached repo: its docs in repo-path order (#118). */}
      {orderedRepos.map((repo) => (
        <DocumentSection
          key={repo.id}
          projectId={projectId}
          initialPage={repo.id in initialRepoPages ? initialRepoPages[repo.id] : EMPTY_PAGE}
          section={{ trackedRepo: repo.id, order: 'path' }}
          heading={<span className="font-mono">{repoShortName(repo.repo_url)}</span>}
          headingId={`section-repo-${repo.id}`}
          emptyTitle="No documents yet from this source"
          emptyBody="A scan of this repository imports its matching files here."
          projects={projects}
          injection={injections[String(repo.id)]}
        />
      ))}

      {/* Everything not from an attached repo — newest-first, as it always was.
          With no repos this IS the whole project list, so it keeps the plain
          "Documents" heading and the original empty copy. */}
      <DocumentSection
        projectId={projectId}
        initialPage={initialOtherPage}
        section={excludeIds.length > 0 ? { excludeTrackedRepos: excludeIds } : {}}
        heading={hasRepos ? 'Other documents' : 'Documents'}
        headingId={`section-${OTHER_SECTION}`}
        emptyTitle={hasRepos ? 'No other documents' : 'No documents in this project yet'}
        emptyBody={
          hasRepos
            ? 'Everything in this project came from a tracked repository above.'
            : 'Import one with the box above, or assign an existing document from its review header or the project chip on any home row.'
        }
        projects={projects}
        injection={injections[String(OTHER_SECTION)]}
      />
    </>
  );
}
