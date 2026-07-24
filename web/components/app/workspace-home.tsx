'use client';

import { useCallback, useMemo, useState } from 'react';
import { ImportForm } from './import-form';
import { DocumentList } from './document-list';
import { ProjectCreate } from './project-create';
import { ProjectsRail } from './projects-rail';
import { ActivityFeedSlot } from './activity-feed-slot';
import { StatsStrip } from './stats-strip';
import { hasMorePages } from '@/lib/document-list-live';
import { compareProjectsByName } from '@/lib/document-groups';
import { useLiveDocumentList } from '@/lib/use-live-document-list';
import { useWorkspaceSummary } from '@/lib/use-workspace-summary';
import { alsoRefresh } from '@/lib/workspace-summary';
import type { Document, DocumentListPage, Project, WorkspaceSummary } from '@/lib/document-types';

// The authenticated home's live surface (SPEC 11; decisions 2A + 5A; M3.6). The
// one client island: it owns the row state so submit-stays-home and per-row
// polling share it without a store or a re-fetch (the shared plumbing lives in
// useLiveDocumentList). The server component seeds page 1 and the workspace's
// projects; from here on the browser drives:
//
//   • submit stays home — a successful import prepends the 202'd document as an
//     importing row (5A); each importing row settles in place to ready/failed (2A).
//   • the list groups by project (headers alphabetical, Unfiled last — 14A) and
//     every row carries a project chip that re-files the document inline.
//   • creating a project (ProjectCreate) adds it to the chips and headers at once.
//
// The import + project panels live here (not the server component) because their
// success handlers are client callbacks a server component can't hand down.
export function WorkspaceHome({
  initialPage,
  initialProjects = [],
  initialSummary = null,
}: {
  initialPage: DocumentListPage | null;
  initialProjects?: Project[];
  /** Server-seeded stats strip (SPEC §16, M3.7); null degrades the strip to nothing (A1). */
  initialSummary?: WorkspaceSummary | null;
}) {
  const {
    degraded,
    items,
    setItems,
    meta,
    loadingMore,
    announcement,
    filter,
    selectFilter,
    handleImported,
    handleSettled,
    handleLoadMore,
    handleRetried,
  } = useLiveDocumentList({ initialPage });
  const [projects, setProjects] = useState<Project[]>(initialProjects);

  // The stats strip's live state (6A): re-read whenever a row settles, retries,
  // or refiles — by piggybacking those existing callbacks, never a second poll
  // loop. A failed read leaves the strip null (renders nothing, A1).
  const { summary, refresh: refreshSummary } = useWorkspaceSummary(initialSummary);

  // A new project joins the chips and headers immediately, name-sorted (the shared
  // 14A comparator) so the selectors read the same order the grouped list will.
  const handleCreated = useCallback((project: Project) => {
    setProjects((prev) => [...prev, project].sort(compareProjectsByName));
  }, []);

  // A row was re-filed (or cleared): update its project so the grouped list
  // re-buckets it under the new header (or Unfiled) on the next render.
  const handleAssigned = useCallback(
    (doc: Document) => {
      setItems((prev) =>
        prev.map((item) => (item.id === doc.id ? { ...item, project: doc.project ?? null } : item)),
      );
    },
    [setItems],
  );

  // Piggyback the summary refresh onto the list callbacks (6A): each also
  // re-reads the strip so its counts stay true as imports settle. Import is
  // included beyond 6A's settle/retry/refile trio so a submitted import bumps
  // documents + "importing" at once (the mockup's live stat) rather than lying
  // until the row settles. Memoized so a stable identity flows down to the rows.
  const onImported = useMemo(
    () => alsoRefresh(handleImported, refreshSummary),
    [handleImported, refreshSummary],
  );
  const onSettled = useMemo(
    () => alsoRefresh(handleSettled, refreshSummary),
    [handleSettled, refreshSummary],
  );
  const onRetried = useMemo(
    () => alsoRefresh(handleRetried, refreshSummary),
    [handleRetried, refreshSummary],
  );
  const onAssigned = useMemo(
    () => alsoRefresh(handleAssigned, refreshSummary),
    [handleAssigned, refreshSummary],
  );

  return (
    <>
      <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-8">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
          Import a document
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Paste a link to a spec or RFC and get a rendered page you can review.
        </p>
        <ImportForm onImported={onImported} />
      </div>

      <StatsStrip summary={summary} />

      <ProjectCreate onCreated={handleCreated} />

      {/* The mocked dashboard (#104): the projects rail beside the documents
          table at `lg`+, a single column below it. The rail is `hidden lg:block`,
          so narrow viewports keep the current single-column grouped list unchanged
          — its project group headers already navigate to the same pages. One live
          list island either way, so polling/refiling is untouched by the layout. */}
      <div className="mt-10 lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
        <ProjectsRail
          projects={projects}
          summary={summary}
          className="hidden lg:col-span-3 lg:block"
        />

        <div className="lg:col-span-9">
          <DocumentList
            items={items}
            total={meta?.total ?? items.length}
            hasMore={hasMorePages(meta)}
            loadingMore={loadingMore}
            onLoadMore={handleLoadMore}
            degraded={degraded}
            announcement={announcement}
            onSettled={onSettled}
            onRetried={onRetried}
            projects={projects}
            onAssigned={onAssigned}
            filter={filter}
            onSelectFilter={selectFilter}
            summary={summary}
            className="mt-0"
            grouped
          />

          <ActivityFeedSlot />
        </div>
      </div>
    </>
  );
}
