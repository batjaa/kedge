import type { Document, DocumentListItem, DocumentListMeta } from './document-types';

/** Keep list rows as responsive as the existing document poller (2A). */
export const POLL_INTERVAL_MS = 1500;

/** Turn the import response into the lean row the home list owns (5A). */
export function toListItem(doc: Document): DocumentListItem {
  return {
    id: doc.id,
    title: doc.title,
    status: doc.status,
    last_sync_status: doc.last_sync_status,
    sync_error: doc.sync_error,
    lifecycle_status: doc.lifecycle_status,
    open_threads_count: 0,
    synced_at: doc.current_version?.synced_at ?? null,
    created_at: doc.created_at,
  };
}

/** Keep a submitted or retried document first without duplicating its row (5A). */
export function prependItem(
  items: DocumentListItem[],
  item: DocumentListItem,
): DocumentListItem[] {
  return [item, ...items.filter((existing) => existing.id !== item.id)];
}

/** Append a later page in order without duplicating prepended rows (#86). */
export function appendItems(
  items: DocumentListItem[],
  incoming: DocumentListItem[],
): DocumentListItem[] {
  const existingIds = new Set(items.map((item) => item.id));
  return [...items, ...incoming.filter((item) => !existingIds.has(item.id))];
}

/** Report whether the document-list paginator has another page (#86). */
export function hasMorePages(
  meta: Pick<DocumentListMeta, 'current_page' | 'last_page'> | null,
): boolean {
  return meta ? meta.current_page < meta.last_page : false;
}

/** Choose the next page unless an in-flight load already owns the click (#86). */
export function nextLoadMorePage(state: {
  meta: Pick<DocumentListMeta, 'current_page' | 'last_page'> | null;
  loading: boolean;
}): number | null {
  if (state.loading) return null;
  if (!hasMorePages(state.meta)) return null;
  return state.meta!.current_page + 1;
}

/** Settle only poll-owned fields while retaining list-only thread data (2A). */
export function mergeSettled(
  items: DocumentListItem[],
  doc: Document,
): DocumentListItem[] {
  return items.map((item) =>
    item.id === doc.id
      ? {
          ...item,
          title: doc.title,
          status: doc.status,
          last_sync_status: doc.last_sync_status,
          sync_error: doc.sync_error,
          lifecycle_status: doc.lifecycle_status,
          synced_at: doc.current_version?.synced_at ?? item.synced_at,
        }
      : item,
  );
}

/** Poll only in-flight rows so an idle list makes no background requests (2A). */
export function shouldPoll(item: Pick<DocumentListItem, 'status'>): boolean {
  return item.status === 'importing';
}

/**
 * Flip a retried row back to `importing` (7A) so its RowPoller re-mounts and
 * settles it live in place. Optimistic and independent of what the retry response
 * says — the row always re-enters the poll loop, and `mergeSettled` overwrites
 * these fields on the next settle. The stale `sync_error` is cleared so the
 * importing interval never shows the old failure.
 */
export function markRetrying(
  items: DocumentListItem[],
  id: number,
): DocumentListItem[] {
  return items.map((item) =>
    item.id === id
      ? { ...item, status: 'importing', last_sync_status: 'ok', sync_error: null }
      : item,
  );
}

/** Give assistive technology one exact announcement when an import settles (10A). */
export function settleAnnouncement(
  doc: Pick<Document, 'status' | 'title'>,
): string | null {
  if (doc.status === 'ready') {
    return `Import ready: ${doc.title}`;
  }

  if (doc.status === 'failed') {
    return `Import failed: ${doc.title}`;
  }

  return null;
}
