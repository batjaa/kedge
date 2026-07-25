'use client';

import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { DocumentList } from './document-list';
import { hasMorePages } from '@/lib/document-list-live';
import { mergeReportedRows } from '@/lib/tracked-repo-scan';
import { useLiveDocumentList } from '@/lib/use-live-document-list';
import type {
  Document,
  DocumentListItem,
  DocumentListPage,
  DocumentSectionQuery,
  Project,
} from '@/lib/document-types';

// One source section on a project page (M3.10 #118, SPEC §11): a repo section
// (its docs in repo-path order) or the "Other documents" section. Each is its own
// live list — server-rendered page 1, its OWN paginated Load more scoped by the
// `section` query (one DB query per section, never a client cull of a shared
// list) — so the shared row component, per-row polling, retry, and reassignment
// all behave exactly as the flat project list did. The parent orchestrator
// (ProjectDocuments) folds freshly-imported rows in through {@link injection}: a
// scan's queued imports land in their repo's section, a paste lands in Other,
// each settling live through the existing per-row path.

/** A batch of freshly-imported importing rows to fold into a section (#118). */
export interface SectionInjection {
  /**
   * Monotonic per section. The merge effect applies only a STRICTLY-newer batch,
   * so a re-render — or React StrictMode's double-invoke — can never re-add a row
   * that was already merged (and later reassigned out): each batch lands once.
   */
  seq: number;
  rows: DocumentListItem[];
}

export function DocumentSection({
  projectId,
  initialPage,
  section,
  heading,
  headingId,
  emptyTitle,
  emptyBody,
  projects,
  injection,
  className = 'mt-8',
}: {
  /** This page's project — reassigning a row out of it drops the row (M3.6). */
  projectId: number;
  /** Server-rendered page 1 for this section; null degrades the list area alone. */
  initialPage: DocumentListPage | null;
  /** The section's grouping controls — threaded into every Load more (#118). */
  section: DocumentSectionQuery;
  heading: ReactNode;
  /** Unique per section so stacked sections don't collide on the heading id. */
  headingId: string;
  emptyTitle: string;
  emptyBody: string;
  projects: Project[];
  /** Rows a scan/paste imported into THIS section since mount (parent-routed). */
  injection?: SectionInjection;
  className?: string;
}) {
  const {
    degraded,
    items,
    setItems,
    meta,
    setMeta,
    loadingMore,
    announcement,
    handleSettled,
    handleLoadMore,
    handleRetried,
  } = useLiveDocumentList({ initialPage, projectFilter: projectId, section });

  // Fold the parent's freshly-imported rows in (prepend, deduped, bump the total)
  // — the same materialize the flat project list did, now scoped to this section.
  // The seq gate makes it exactly-once: `lastSeq` advances before the state
  // updaters run, so StrictMode's re-invoke short-circuits, and `mergeReportedRows`
  // dedupes anything a Load more already surfaced. `added` is set inside the items
  // updater and read by the meta updater, which React applies in enqueue order.
  const lastSeq = useRef(0);
  useEffect(() => {
    if (!injection || injection.seq <= lastSeq.current) return;
    lastSeq.current = injection.seq;
    let added = 0;
    setItems((prev) => {
      const merged = mergeReportedRows(prev, injection.rows);
      added = merged.added; // idempotent assignment — StrictMode-safe
      return merged.items;
    });
    setMeta((prev) => (prev && added > 0 ? { ...prev, total: prev.total + added } : prev));
  }, [injection, setItems, setMeta]);

  // Reassigning a row OUT of this project removes it from the page; staying (a
  // no-op, or a move between sections of the same project — impossible, provenance
  // is immutable) updates it in place. The flat project list's exact rule.
  const handleAssigned = useCallback(
    (doc: Document) => {
      if ((doc.project?.id ?? null) === projectId) {
        setItems((prev) =>
          prev.map((item) => (item.id === doc.id ? { ...item, project: doc.project ?? null } : item)),
        );
      } else {
        setItems((prev) => prev.filter((item) => item.id !== doc.id));
        setMeta((prev) => (prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev));
      }
    },
    [projectId, setItems, setMeta],
  );

  return (
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
      heading={heading}
      headingId={headingId}
      emptyTitle={emptyTitle}
      emptyBody={emptyBody}
      className={className}
    />
  );
}
