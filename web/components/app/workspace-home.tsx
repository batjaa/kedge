'use client';

import { useCallback, useState } from 'react';
import { ImportForm } from './import-form';
import { DocumentList } from './document-list';
import {
  markRetrying,
  mergeSettled,
  prependItem,
  settleAnnouncement,
  toListItem,
} from '@/lib/document-list-live';
import type { Document, DocumentListItem, DocumentListPage } from '@/lib/document-types';

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
  const [degraded] = useState(initialPage === null);
  const [items, setItems] = useState<DocumentListItem[]>(initialPage?.data ?? []);
  const [total, setTotal] = useState(initialPage?.meta.total ?? 0);
  const [announcement, setAnnouncement] = useState('');

  const handleImported = useCallback((doc: Document) => {
    setItems((prev) => prependItem(prev, toListItem(doc)));
    setTotal((prev) => prev + 1);
  }, []);

  const handleSettled = useCallback((doc: Document) => {
    setItems((prev) => mergeSettled(prev, doc));
    const message = settleAnnouncement(doc);
    if (message) setAnnouncement(message);
  }, []);

  // A row's inline retry succeeded: flip it back to importing so its RowPoller
  // re-mounts and settles it live in place (7A) — the same live path a fresh
  // import takes, announced through the region via handleSettled when it lands
  // (a recovery to ready reads as a new "Import ready" message).
  const handleRetried = useCallback((id: number) => {
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
        total={total}
        degraded={degraded}
        announcement={announcement}
        onSettled={handleSettled}
        onRetried={handleRetried}
      />
    </>
  );
}
