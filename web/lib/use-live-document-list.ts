import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from 'react';
import {
  appendItems,
  applyFilterPage,
  applyImport,
  type LiveListState,
  lifecycleParam,
  markRetrying,
  mergeSettled,
  nextLoadMorePage,
  settleAnnouncement,
} from './document-list-live';
import { readDocumentPage } from './documents-client';
import type {
  Document,
  DocumentLifecycleFilter,
  DocumentListItem,
  DocumentListMeta,
  DocumentListPage,
} from './document-types';

// The live document-list island state (SPEC 11; decisions 2A + 5A + 7A + 10A),
// shared by the home (WorkspaceHome) and a project page (ProjectDocuments) so
// submit-stays-put, per-row settle, Load more, and the retry re-poll behave
// identically on both surfaces. Everything the two surfaces DON'T share —
// grouping, the row's project chip, and how a reassignment mutates the list —
// stays in each island (via the exposed `setItems`/`setMeta`).
//
// The rows, paginator, and the active lifecycle chip are ONE slice (LiveListState)
// so the 5A transitions are pure and atomic (applyImport / applyFilterPage): a
// fresh import flips the chip to All so its row is never hidden, and a chip
// selection refetches server-side (correct across pagination) rather than culling
// the loaded rows — which is what lets settled rows keep their place until the
// next filter change. `setItems`/`setMeta` stay exposed (they mutate the slice's
// rows / paginator) so each surface keeps owning grouping and reassignment.

export interface LiveDocumentList {
  /** Page 1 was a degraded (null) server read — the API was unreachable (3A). */
  degraded: boolean;
  items: DocumentListItem[];
  setItems: Dispatch<SetStateAction<DocumentListItem[]>>;
  meta: DocumentListMeta | null;
  setMeta: Dispatch<SetStateAction<DocumentListMeta | null>>;
  loadingMore: boolean;
  announcement: string;
  setAnnouncement: Dispatch<SetStateAction<string>>;
  /** The active lifecycle chip (5A); `all` on a project page (no chips there). */
  filter: DocumentLifecycleFilter;
  /** Select a chip: refetch page 1 under it, server-side (5A/7A). */
  selectFilter: (filter: DocumentLifecycleFilter) => void;
  handleImported: (doc: Document) => void;
  handleSettled: (doc: Document) => void;
  handleLoadMore: () => Promise<void>;
  handleRetried: (id: number) => void;
}

export function useLiveDocumentList({
  initialPage,
  projectFilter,
}: {
  initialPage: DocumentListPage | null;
  /** Scope Load more to a project (id) or the Unfiled bucket — the project page. */
  projectFilter?: string | number;
}): LiveDocumentList {
  // A null page 1 is the degraded read (3A). Fixed for this render's lifetime.
  const degraded = initialPage === null;
  const [state, setState] = useState<LiveListState>({
    items: initialPage?.data ?? [],
    meta: initialPage?.meta ?? null,
    filter: 'all',
  });
  const { items, meta, filter } = state;
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  // Generation for list-replacing fetches (chip select + import reconcile): a
  // slow older read can't overwrite a newer chip, and a Load more captures it to
  // drop a page that resolves after the filter changed under it (latest-wins).
  const filterGenRef = useRef(0);
  // True while a replace is in flight, so Load more won't append onto a list that
  // is about to be wholesale-replaced.
  const replacingRef = useRef(false);

  // Rows/paginator setters over the slice — the exposed interface each surface
  // uses for grouping and reassignment stays identical. Two separate setState
  // calls still apply in enqueue order (items updater, then meta updater), so a
  // caller that reads state set by the first inside the second (the project page's
  // scan-materialize count) keeps working.
  const setItems = useCallback<Dispatch<SetStateAction<DocumentListItem[]>>>((action) => {
    setState((prev) => ({
      ...prev,
      items: typeof action === 'function' ? (action as (i: DocumentListItem[]) => DocumentListItem[])(prev.items) : action,
    }));
  }, []);
  const setMeta = useCallback<Dispatch<SetStateAction<DocumentListMeta | null>>>((action) => {
    setState((prev) => ({
      ...prev,
      meta:
        typeof action === 'function'
          ? (action as (m: DocumentListMeta | null) => DocumentListMeta | null)(prev.meta)
          : action,
    }));
  }, []);

  // Refetch page 1 under a filter and REPLACE the list — the one path for a chip
  // selection and for reconciling an import made under a filter (below). Two
  // guards keep it honest: `filterGenRef` bumps on every replace so a slow older
  // read can't overwrite a newer chip (latest-wins), and the filter is committed
  // only WITH its rows (applyFilterPage) on success — a failed read leaves the
  // current chip and rows untouched rather than stranding the new chip over the
  // old rows. `replacingRef` blocks a Load more from appending onto a list that is
  // about to be replaced. Filtering is a refetch, never a client cull, so it is
  // correct across pagination (7A).
  const replaceWithFilter = useCallback(
    async (next: DocumentLifecycleFilter): Promise<void> => {
      const token = ++filterGenRef.current;
      replacingRef.current = true;
      try {
        const page = await readDocumentPage(1, projectFilter, lifecycleParam(next));
        if (filterGenRef.current !== token) return; // superseded by a newer chip
        if (page) setState((prev) => applyFilterPage(prev, page, next));
      } finally {
        // Only the still-current replace clears the flag; a superseded one leaves
        // it owned by the newer replace already in flight.
        if (filterGenRef.current === token) replacingRef.current = false;
      }
    },
    [projectFilter],
  );

  // A successful import prepends the 202'd document as an importing row (5A),
  // bumps meta.total, AND flips the active chip to All so the new row is never
  // hidden by a lifecycle filter. When a filter WAS active, the optimistic flip
  // shows only the old filtered subset under All — so reconcile with the true All
  // page 1 (which already carries this import), fixing the count and Load more.
  const handleImported = useCallback(
    (doc: Document) => {
      const wasFiltered = filter !== 'all';
      setState((prev) => applyImport(prev, doc));
      if (wasFiltered) void replaceWithFilter('all');
    },
    [filter, replaceWithFilter],
  );

  const handleSettled = useCallback((doc: Document) => {
    setItems((prev) => mergeSettled(prev, doc));
    const message = settleAnnouncement(doc);
    if (message) setAnnouncement(message);
  }, [setItems]);

  // The ref guards the synchronous double-click batched state cannot (#86); a
  // failed fetch keeps every loaded row and leaves meta untouched so Load more
  // reappears. The project filter keeps the appended page scoped (M3.6) and the
  // active lifecycle chip keeps it narrowed (7A) — page 2 filters like page 1. The
  // generation captured at the start is re-checked before applying, and a pending
  // filter replace blocks the append outright, so a page that resolves after a
  // chip change never contaminates the new filter's list.
  const handleLoadMore = useCallback(async () => {
    if (loadingRef.current || replacingRef.current) return;
    const next = nextLoadMorePage({ meta });
    if (next === null) return;
    const token = filterGenRef.current;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const page = await readDocumentPage(next, projectFilter, lifecycleParam(filter));
      if (page && filterGenRef.current === token) {
        setItems((prev) => appendItems(prev, page.data));
        setMeta(page.meta);
      }
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [meta, projectFilter, filter, setItems, setMeta]);

  // A row's inline retry succeeded: flip it back to importing so its RowPoller
  // re-mounts and settles it live in place (7A). Clear the live region first so a
  // deterministic re-fail re-announces (React bails on an identical state update).
  const handleRetried = useCallback((id: number) => {
    setAnnouncement('');
    setItems((prev) => markRetrying(prev, id));
  }, [setItems]);

  // Select a lifecycle chip (5A): refetch page 1 under it and commit the chip WITH
  // its rows on success (never before), so the active chip always reflects the
  // rows on screen.
  const selectFilter = useCallback(
    (next: DocumentLifecycleFilter) => {
      void replaceWithFilter(next);
    },
    [replaceWithFilter],
  );

  return {
    degraded,
    items,
    setItems,
    meta,
    setMeta,
    loadingMore,
    announcement,
    setAnnouncement,
    filter,
    selectFilter,
    handleImported,
    handleSettled,
    handleLoadMore,
    handleRetried,
  };
}
