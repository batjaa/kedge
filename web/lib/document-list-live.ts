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
    project: doc.project ?? null,
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

/**
 * Choose the next page, or null when the paginator is exhausted (#86). The
 * synchronous double-click guard is the caller's in-flight ref (loadingRef), not
 * a param here — a batched `loading` state would still be false on the second
 * click of a rapid pair, so this predicate only owns "is there a next page".
 */
export function nextLoadMorePage(state: {
  meta: Pick<DocumentListMeta, 'current_page' | 'last_page'> | null;
}): number | null {
  if (!hasMorePages(state.meta)) return null;
  return state.meta!.current_page + 1;
}

/**
 * Settle only poll-owned fields while retaining list-only data (2A). Built on
 * {@link toListItem} so the doc→row projection lives in exactly one place, then
 * overrides the fields the poll must NOT clobber: the row's `open_threads_count`
 * and `created_at` (never carried by the poll doc's list shape), the `synced_at`
 * fallback to the row's prior value while a settle carries no fresh version, and
 * the row's `project` — assignment (onAssigned) is the list's authority for it,
 * so an in-flight poll that raced an assignment can't revert the row to its
 * pre-assignment project (M3.6).
 */
export function mergeSettled(
  items: DocumentListItem[],
  doc: Document,
): DocumentListItem[] {
  return items.map((item) =>
    item.id === doc.id
      ? {
          ...toListItem(doc),
          open_threads_count: item.open_threads_count,
          created_at: item.created_at,
          synced_at: doc.current_version?.synced_at ?? item.synced_at,
          project: item.project,
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
