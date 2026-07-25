'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImportForm } from './import-form';
import { DocumentList } from './document-list';
import { ProjectCreate } from './project-create';
import { ProjectsRail } from './projects-rail';
import { ActivityFeed } from './activity-feed';
import { StatsStrip } from './stats-strip';
import { hasMorePages } from '@/lib/document-list-live';
import { compareProjectsByName } from '@/lib/document-groups';
import { useLiveDocumentList } from '@/lib/use-live-document-list';
import { useWorkspaceSummary } from '@/lib/use-workspace-summary';
import { alsoRefresh, createLatestWinsGate } from '@/lib/workspace-summary';
import { nextProjects, readProjects } from '@/lib/projects-live';
import type { Document, DocumentListPage, Project, WorkspaceSummary } from '@/lib/document-types';
import type { ActivityEvent } from '@/lib/activity-types';

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
  initialProjectsDegraded = false,
  initialSummary = null,
  initialActivity = null,
}: {
  initialPage: DocumentListPage | null;
  initialProjects?: Project[];
  /**
   * Whether the server's projects seed failed (non-200). A failed read returns an
   * empty list indistinguishable from a genuinely project-less workspace, so the
   * rail must not derive an Unfiled count from it (that would read every document
   * as Unfiled). Cleared the moment a client refresh succeeds.
   */
  initialProjectsDegraded?: boolean;
  /** Server-seeded stats strip (SPEC §16, M3.7); null degrades the strip to nothing (A1). */
  initialSummary?: WorkspaceSummary | null;
  /**
   * Server-seeded Recent-activity feed (SPEC §16, M3.8 #111). Loaded once on page
   * load — no polling (M5 owns liveness). null degrades the panel to nothing (A1);
   * [] is an empty workspace's designed empty state.
   */
  initialActivity?: ActivityEvent[] | null;
}) {
  const t = useTranslations('dashboard');
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
  const [projectsDegraded, setProjectsDegraded] = useState(initialProjectsDegraded);

  // The stats strip's live state (6A): re-read whenever a row settles, retries,
  // or refiles — by piggybacking those existing callbacks, never a second poll
  // loop. A failed read leaves the strip null (renders nothing, A1).
  const { summary, refresh: refreshSummary } = useWorkspaceSummary(initialSummary);

  // The projects rail's live state (6A generalized to the rail, #104): a refile
  // changes per-project doc/open/orphan counts without moving the workspace
  // totals, so the summary refresh alone can't repair them — the rail re-reads
  // the projects list on the same callbacks. A failed refresh keeps the last-good
  // rail (nextProjects) and its degraded flag; a successful one clears degradation.
  // Overlapping refreshes are gated latest-wins, the summary's exact discipline.
  const projectsGateRef = useRef(createLatestWinsGate());
  const refreshProjects = useCallback(() => {
    const token = projectsGateRef.current.begin();
    void readProjects().then((fetched) => {
      if (!projectsGateRef.current.isCurrent(token)) return;
      // A transient miss (null) keeps the last-good rail and its degraded flag;
      // only a real read replaces the counts and clears degradation.
      setProjects((prev) => nextProjects(prev, fetched));
      if (fetched !== null) setProjectsDegraded(false);
    });
  }, []);

  // One dashboard refresh piggybacked on the list callbacks: the strip and the
  // rail re-read together as rows settle/retry/refile/import (6A). Still no new
  // poll loop — both reads ride the existing callbacks.
  const refreshDashboard = useCallback(() => {
    refreshSummary();
    refreshProjects();
  }, [refreshSummary, refreshProjects]);

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
    () => alsoRefresh(handleImported, refreshDashboard),
    [handleImported, refreshDashboard],
  );
  const onSettled = useMemo(
    () => alsoRefresh(handleSettled, refreshDashboard),
    [handleSettled, refreshDashboard],
  );
  const onRetried = useMemo(
    () => alsoRefresh(handleRetried, refreshDashboard),
    [handleRetried, refreshDashboard],
  );
  const onAssigned = useMemo(
    () => alsoRefresh(handleAssigned, refreshDashboard),
    [handleAssigned, refreshDashboard],
  );

  return (
    <>
      <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-8">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
          {t('importPanel.title')}
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {t('importPanel.body')}
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
          degraded={projectsDegraded}
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

          <ActivityFeed events={initialActivity} />
        </div>
      </div>
    </>
  );
}
