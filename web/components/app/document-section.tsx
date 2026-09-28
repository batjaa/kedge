'use client';

import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { DocumentList } from './document-list';
import { hasMorePages } from '@/lib/document-list-live';
import {
  isDocumentProcessing,
  mergeDocumentStates,
  mergeReportedRows,
  type TrackedDocumentState,
} from '@/lib/tracked-repo-scan';
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
  directoryDividers = false,
  processingStates = [],
  processingKey = null,
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
  /** Interleave directory dividers (#119) — a repo section, never Other. */
  directoryDividers?: boolean;
  /** One repo's batched current-state projection; list metadata stays untouched. */
  processingStates?: TrackedDocumentState[];
  /** Identity of the report that supplied `processingStates`, if any. */
  processingKey?: string | null;
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
    reload,
  } = useLiveDocumentList({ initialPage, projectFilter: projectId, section });

  // When this section's SCOPE changes — a repo tracked/untracked shifts the Other
  // section's exclusion set (#118) — refetch page 1 so a now-orphaned document
  // (its `tracked_repo_id` nulled on un-track) resurfaces here instead of
  // vanishing until a navigation: grouping never hides a document. Gated on the
  // query's CONTENT (not its object identity, which repo sections churn every
  // render) and skipped on mount, whose read is already the server page — so a
  // repo section (stable query) never refetches. StrictMode-safe: the first
  // invoke only records the signature, so its double-run can't fire a reload.
  const sectionSig = JSON.stringify(section);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (lastSig.current === null || lastSig.current === sectionSig) {
      lastSig.current = sectionSig;
      return;
    }
    lastSig.current = sectionSig;
    reloadRef.current();
  }, [sectionSig]);

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

  // The tracked-repo report has no authority over document work. Its separate,
  // batched current-state projection updates rows in place, including a readable
  // prior version during re-sync, without an N-per-document read.
  useEffect(() => {
    if (processingStates.length === 0) return;
    setItems((prev) => mergeDocumentStates(prev, processingStates));
  }, [processingStates, setItems]);

  // The batch projection deliberately contains only processing fields: it keeps
  // its query bounded and avoids duplicating DocumentListResource. Once that
  // batch is terminal, reconcile this one source section exactly once for its
  // report. This replaces the retired per-document polls with one list read, so
  // newly imported placeholder rows receive their authoritative title/version
  // metadata and a completed re-sync can refresh list-only fields. `reload` is
  // latest-wins, so a later scan cannot be overwritten by this older read.
  const reconciledProcessing = useRef<string | null>(null);
  useEffect(() => {
    if (processingKey === null || processingStates.length === 0) return;
    if (processingStates.some(isDocumentProcessing)) return;
    if (reconciledProcessing.current === processingKey) return;

    reconciledProcessing.current = processingKey;
    reloadRef.current();
  }, [processingKey, processingStates]);

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
      directoryDividers={directoryDividers}
      batchProcessingIds={processingStates.filter(isDocumentProcessing).map((state) => state.id)}
      heading={heading}
      headingId={headingId}
      emptyTitle={emptyTitle}
      emptyBody={emptyBody}
      className={className}
    />
  );
}
