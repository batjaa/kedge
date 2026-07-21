import type { Document, DocumentListItem } from './document-types';

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
