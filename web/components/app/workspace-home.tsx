'use client';

import { useCallback, useRef, useState } from 'react';
import { ImportForm } from './import-form';
import { DocumentList } from './document-list';
import {
  appendItems,
  hasMorePages,
  markRetrying,
  mergeSettled,
  nextLoadMorePage,
  prependItem,
  settleAnnouncement,
  toListItem,
} from '@/lib/document-list-live';
import { readDocumentPage } from '@/lib/documents-client';
import type {
  Document,
  DocumentListItem,
  DocumentListMeta,
  DocumentListPage,
} from '@/lib/document-types';

// The authenticated home's live surface (SPEC 11; decisions 2A + 5A). The one
// client island: it owns the row state so submit-stays-home and per-row polling
// share it without a store or a re-fetch. The server component seeds page 1;
// from here on the browser drives:
//
//   • submit stays home — a successful import prepends the 202'd document as an
//     importing row (5A) instead of navigating; a failed submit keeps ImportForm's
//     inline error and adds no row.
//   • each importing row polls the per-doc BFF route and settles in place to
//     ready/failed (2A); the settle is announced through a polite live region (10A).
//
// The import panel lives here (not the server component) because ImportForm's
// success handler is a client callback — a server component can't hand one down.
export function WorkspaceHome({ initialPage }: { initialPage: DocumentListPage | null }) {
  // A null page 1 is the degraded read (3A) — the API was unreachable server-side.
  // Fixed for this render's lifetime (no setter ever ran), so a plain const.
  const degraded = initialPage === null;
  const [items, setItems] = useState<DocumentListItem[]>(initialPage?.data ?? []);
  const [meta, setMeta] = useState<DocumentListMeta | null>(initialPage?.meta ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);
  const [announcement, setAnnouncement] = useState('');

  // The workspace count derives from meta alone (its single source of truth): an
  // import bumps meta.total, Load more refreshes it. The fallback to items.length
  // covers the degraded-null read, where the chip counts this session's imports.
  const handleImported = useCallback((doc: Document) => {
    setItems((prev) => prependItem(prev, toListItem(doc)));
    setMeta((prev) => (prev ? { ...prev, total: prev.total + 1 } : prev));
  }, []);

  const handleSettled = useCallback((doc: Document) => {
    setItems((prev) => mergeSettled(prev, doc));
    const message = settleAnnouncement(doc);
    if (message) setAnnouncement(message);
  }, []);

  // The ref guards the synchronous double-click that batched state cannot (#86);
  // a failed fetch keeps every loaded row and leaves meta untouched so Load more reappears.
  const handleLoadMore = useCallback(async () => {
    if (loadingRef.current) return;
    const next = nextLoadMorePage({ meta });
    if (next === null) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const page = await readDocumentPage(next);
      if (page) {
        setItems((prev) => appendItems(prev, page.data));
        setMeta(page.meta);
      }
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [meta]);

  // A row's inline retry succeeded: flip it back to importing so its RowPoller
  // re-mounts and settles it live in place (7A) — the same live path a fresh
  // import takes, announced through the region via handleSettled when it lands
  // (a recovery to ready reads as a new "Import ready" message).
  const handleRetried = useCallback((id: number) => {
    // Clear the live region first: a deterministic re-fail settles to the SAME
    // "Import failed: X" message, and React bails out on an identical state update
    // — so without resetting to '' between settles the aria-live region stays
    // silent on the second failure. The empty string re-announces the next settle.
    setAnnouncement('');
    setItems((prev) => markRetrying(prev, id));
  }, []);

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
      />
    </>
  );
}
