import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from 'react';
import {
  appendItems,
  markRetrying,
  mergeSettled,
  nextLoadMorePage,
  prependItem,
  settleAnnouncement,
  toListItem,
} from './document-list-live';
import { readDocumentPage } from './documents-client';
import type {
  Document,
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
  const [items, setItems] = useState<DocumentListItem[]>(initialPage?.data ?? []);
  const [meta, setMeta] = useState<DocumentListMeta | null>(initialPage?.meta ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);
  const [announcement, setAnnouncement] = useState('');

  // A successful import prepends the 202'd document as an importing row (5A) and
  // bumps meta.total (the count chip's single source of truth).
  const handleImported = useCallback((doc: Document) => {
    setItems((prev) => prependItem(prev, toListItem(doc)));
    setMeta((prev) => (prev ? { ...prev, total: prev.total + 1 } : prev));
  }, []);

  const handleSettled = useCallback((doc: Document) => {
    setItems((prev) => mergeSettled(prev, doc));
    const message = settleAnnouncement(doc);
    if (message) setAnnouncement(message);
  }, []);

  // The ref guards the synchronous double-click batched state cannot (#86); a
  // failed fetch keeps every loaded row and leaves meta untouched so Load more
  // reappears. The project filter keeps the appended page scoped (M3.6).
  const handleLoadMore = useCallback(async () => {
    if (loadingRef.current) return;
    const next = nextLoadMorePage({ meta });
    if (next === null) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const page = await readDocumentPage(next, projectFilter);
      if (page) {
        setItems((prev) => appendItems(prev, page.data));
        setMeta(page.meta);
      }
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [meta, projectFilter]);

  // A row's inline retry succeeded: flip it back to importing so its RowPoller
  // re-mounts and settles it live in place (7A). Clear the live region first so a
  // deterministic re-fail re-announces (React bails on an identical state update).
  const handleRetried = useCallback((id: number) => {
    setAnnouncement('');
    setItems((prev) => markRetrying(prev, id));
  }, []);

  return {
    degraded,
    items,
    setItems,
    meta,
    setMeta,
    loadingMore,
    announcement,
    setAnnouncement,
    handleImported,
    handleSettled,
    handleLoadMore,
    handleRetried,
  };
}
