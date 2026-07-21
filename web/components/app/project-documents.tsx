'use client';

import { useCallback } from 'react';
import { ImportForm } from './import-form';
import { DocumentList } from './document-list';
import { hasMorePages } from '@/lib/document-list-live';
import { useLiveDocumentList } from '@/lib/use-live-document-list';
import type { Document, DocumentListPage, Project } from '@/lib/document-types';

// A project page's live document surface (SPEC §16 story 6, M3.6) — the M3.5
// home re-scoped to one project: the same row components, per-row polling, retry
// affordance, and Load more, filtered to this project (the clamp/pagination
// convention carried by the shared hook). The import box here targets the
// project, so a paste lands filed. Reassigning a doc OUT of this project (or to
// Unfiled) removes its row; the row chip is how that move is made.
export function ProjectDocuments({
  projectId,
  initialPage,
  projects,
}: {
  projectId: number;
  initialPage: DocumentListPage | null;
  projects: Project[];
}) {
  const {
    degraded,
    items,
    setItems,
    meta,
    setMeta,
    loadingMore,
    announcement,
    handleImported,
    handleSettled,
    handleLoadMore,
    handleRetried,
  } = useLiveDocumentList({ initialPage, projectFilter: projectId });

  const handleAssigned = useCallback(
    (doc: Document) => {
      const stays = (doc.project?.id ?? null) === projectId;
      if (stays) {
        setItems((prev) =>
          prev.map((item) => (item.id === doc.id ? { ...item, project: doc.project ?? null } : item)),
        );
      } else {
        // Moved to another project (or Unfiled): it no longer belongs on this
        // page — drop the row and decrement the count.
        setItems((prev) => prev.filter((item) => item.id !== doc.id));
        setMeta((prev) => (prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev));
      }
    },
    [projectId, setItems, setMeta],
  );

  return (
    <>
      <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-8">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
          Import into this project
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Paste a link or content and it lands here, filed under this project.
        </p>
        <ImportForm onImported={handleImported} projectId={projectId} />
      </div>

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
        heading="Documents"
        emptyTitle="No documents in this project yet"
        emptyBody="Import one with the box above, or assign an existing document from its review header or the project chip on any home row."
      />
    </>
  );
}
