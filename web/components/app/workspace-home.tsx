'use client';

import { useCallback, useState } from 'react';
import { ImportForm } from './import-form';
import { DocumentList } from './document-list';
import { ProjectCreate } from './project-create';
import { hasMorePages } from '@/lib/document-list-live';
import { compareProjectsByName } from '@/lib/document-groups';
import { useLiveDocumentList } from '@/lib/use-live-document-list';
import type { Document, DocumentListPage, Project } from '@/lib/document-types';

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
}: {
  initialPage: DocumentListPage | null;
  initialProjects?: Project[];
}) {
  const {
    degraded,
    items,
    setItems,
    meta,
    loadingMore,
    announcement,
    handleImported,
    handleSettled,
    handleLoadMore,
    handleRetried,
  } = useLiveDocumentList({ initialPage });
  const [projects, setProjects] = useState<Project[]>(initialProjects);

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

  return (
    <>
      <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-8">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
          Import a document
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Paste a link to a spec or RFC and get a rendered page you can review.
        </p>
        <ImportForm onImported={handleImported} />
      </div>

      <ProjectCreate onCreated={handleCreated} />

      <DocumentList
        items={items}
        total={meta?.total ?? items.length}
        hasMore={hasMorePages(meta)}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
        degraded={degraded}
        announcement={announcement}
        onSettled={handleSettled}
        onRetried={handleRetried}
        projects={projects}
        onAssigned={handleAssigned}
        grouped
      />
    </>
  );
}
