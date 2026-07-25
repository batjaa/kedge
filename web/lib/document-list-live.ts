import type {
  Document,
  DocumentLifecycleFilter,
  DocumentListItem,
  DocumentListMeta,
  DocumentListPage,
  DocumentSectionQuery,
} from './document-types';

// The poll cadence moved to its single home in lib/use-poll-until-settled.ts (12A),
// which now owns the timer/settle/cleanup skeleton every poller shares.

/**
 * The list endpoint's `lifecycle` query value for the active chip, or undefined
 * for All so the request omits the parameter entirely (the server reads absent as
 * All). Threaded into BOTH a filter selection and Load more so the server narrows
 * the whole set across pagination, never just the loaded page (7A).
 */
export function lifecycleParam(filter: DocumentLifecycleFilter): string | undefined {
  return filter === 'all' ? undefined : filter;
}

/**
 * Write a project page's source-grouping controls (#118) onto a document-list
 * query string — the ONE place the web maps {@link DocumentSectionQuery} to the
 * API's `tracked_repo` / `order` / `exclude_tracked_repos` parameters, so the
 * server-rendered initial page and the client Load more can never drift on the
 * names. Empty/absent fields write nothing, leaving the plain newest-first list.
 */
export function applySectionQuery(params: URLSearchParams, query?: DocumentSectionQuery): void {
  if (!query) return;
  if (query.trackedRepo !== undefined) params.set('tracked_repo', String(query.trackedRepo));
  if (query.order) params.set('order', query.order);
  if (query.excludeTrackedRepos && query.excludeTrackedRepos.length > 0) {
    params.set('exclude_tracked_repos', query.excludeTrackedRepos.join(','));
  }
}

/**
 * The live document list's client slice: the loaded rows, the paginator, and the
 * active lifecycle chip. Held as one object so the 5A transitions below are pure
 * and atomic — the hook owns exactly this.
 */
export interface LiveListState {
  items: DocumentListItem[];
  meta: DocumentListMeta | null;
  filter: DocumentLifecycleFilter;
}

/**
 * Fold a fresh import into the live list (5A): prepend the 202'd document as an
 * importing row (deduped, newest first), bump the paginator total, and flip the
 * chip back to All — so a submitted import is never hidden by an active lifecycle
 * filter and its row stays watchable while it settles. The whole point of 5A:
 * filtering never hides work in flight.
 */
export function applyImport(state: LiveListState, doc: Document): LiveListState {
  return {
    items: prependItem(state.items, toListItem(doc)),
    meta: state.meta ? { ...state.meta, total: state.meta.total + 1 } : state.meta,
    filter: 'all',
  };
}

/**
 * Fold a filter selection's server page into the live list (5A): replace the rows
 * and paginator wholesale under the chosen chip. Filtering is a *refetch*, never a
 * client cull — so a row that settled out of the new filter drops HERE, on the
 * refetch, and not the instant it settled. That is precisely what lets a settled
 * row keep its place (with its new chip) until the next filter change.
 */
export function applyFilterPage(
  state: LiveListState,
  page: DocumentListPage,
  filter: DocumentLifecycleFilter,
): LiveListState {
  return { ...state, items: page.data, meta: page.meta, filter };
}

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
    // Provenance is immutable, server-derived (M3.10) — carried straight through
    // so a live-prepended import row shows its chip without a list refetch.
    source: doc.source,
    tracked_repo_id: doc.tracked_repo_id,
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
          // `source` / `tracked_repo_id` ride through from toListItem(doc): the
          // settle payload is the server's authority for provenance (M3.10).
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

/** A settle worth announcing to assistive technology (10A). */
export type SettleOutcome = 'ready' | 'failed';

/**
 * Classify a settle for the one exact screen-reader announcement (10A). Pure —
 * the hook maps the outcome to the localized `documents.announce.*` string
 * (M3.9 #123), so this module stays free of copy in any language.
 */
export function settleOutcome(doc: Pick<Document, 'status'>): SettleOutcome | null {
  return doc.status === 'ready' || doc.status === 'failed' ? doc.status : null;
}
