import { describe, expect, it } from 'vitest';
import {
  appendItems,
  applyFilterPage,
  applyImport,
  hasMorePages,
  type LiveListState,
  lifecycleParam,
  markRetrying,
  mergeSettled,
  nextLoadMorePage,
  prependItem,
  settleAnnouncement,
  shouldPoll,
  toListItem,
} from '@/lib/document-list-live';
import type {
  Document,
  DocumentListItem,
  DocumentListMeta,
  DocumentListPage,
} from '@/lib/document-types';

describe('document list live state', () => {
  describe('prependItem', () => {
    it('prepends a new item and preserves the prior order', () => {
      const items = [item({ id: 1 }), item({ id: 2 })];

      const result = prependItem(items, item({ id: 3 }));

      expect(result.map(({ id }) => id)).toEqual([3, 1, 2]);
    });

    it('moves an existing item to the front without duplicating it', () => {
      const items = [item({ id: 1 }), item({ id: 2 }), item({ id: 3 })];

      const result = prependItem(items, item({ id: 2, title: 'Retried' }));

      expect(result).toHaveLength(3);
      expect(result.map(({ id }) => id)).toEqual([2, 1, 3]);
      expect(result[0].title).toBe('Retried');
    });

    it('does not mutate the input array', () => {
      const first = item({ id: 1 });
      const second = item({ id: 2 });
      const items = [first, second];

      const result = prependItem(items, item({ id: 3 }));

      expect(items).toEqual([first, second]);
      expect(result).not.toBe(items);
    });
  });

  describe('shouldPoll', () => {
    it('returns true only while the item is importing', () => {
      expect(shouldPoll({ status: 'importing' })).toBe(true);
      expect(shouldPoll({ status: 'ready' })).toBe(false);
      expect(shouldPoll({ status: 'failed' })).toBe(false);
    });
  });

  describe('mergeSettled', () => {
    it('settles an importing row to ready in place and preserves its thread count', () => {
      const items = [
        item({
          id: 1,
          status: 'importing',
          open_threads_count: 4,
          synced_at: null,
        }),
      ];

      const result = mergeSettled(
        items,
        document({
          id: 1,
          status: 'ready',
          current_version: version({ synced_at: '2026-07-21T12:00:00Z' }),
        }),
      );

      expect(result).not.toBe(items);
      expect(result[0]).toMatchObject({
        status: 'ready',
        open_threads_count: 4,
        synced_at: '2026-07-21T12:00:00Z',
      });
    });

    it('carries the sync error when an import settles to failed', () => {
      const result = mergeSettled(
        [item({ id: 1, status: 'importing' })],
        document({
          id: 1,
          status: 'failed',
          last_sync_status: 'failed',
          sync_error: 'Source unreachable',
        }),
      );

      expect(result[0]).toMatchObject({
        status: 'failed',
        last_sync_status: 'failed',
        sync_error: 'Source unreachable',
      });
    });

    it('leaves the list unchanged when the document id is absent', () => {
      const items = [item({ id: 1 }), item({ id: 2 })];

      const result = mergeSettled(items, document({ id: 3, status: 'ready' }));

      expect(result).toEqual(items);
      expect(result).not.toBe(items);
    });

    it('leaves other rows untouched', () => {
      const untouched = item({ id: 2, title: 'Other document' });
      const items = [item({ id: 1, status: 'importing' }), untouched];

      const result = mergeSettled(items, document({ id: 1, status: 'ready' }));

      expect(result[1]).toBe(untouched);
    });

    it("preserves the row's project so a settle can't revert a concurrent assignment (M3.6)", () => {
      // The row was filed under Anchoring while importing; the settling poll doc
      // — an in-flight read that may predate the assignment — must not clobber it.
      const items = [
        item({ id: 1, status: 'importing', project: { id: 10, name: 'Anchoring' } }),
      ];

      const result = mergeSettled(items, document({ id: 1, status: 'ready' }));

      expect(result[0].project).toEqual({ id: 10, name: 'Anchoring' });
    });
  });

  describe('markRetrying', () => {
    it('flips a retried failed row back to importing so shouldPoll re-arms it (7A)', () => {
      const items = [
        item({
          id: 1,
          status: 'failed',
          last_sync_status: 'failed',
          sync_error: 'URL not allowed (private address).',
          open_threads_count: 2,
        }),
      ];

      const result = markRetrying(items, 1);

      expect(result[0]).toMatchObject({
        status: 'importing',
        last_sync_status: 'ok',
        sync_error: null,
        // Row-only data is preserved across the flip.
        open_threads_count: 2,
      });
      expect(shouldPoll(result[0])).toBe(true);
    });

    it('leaves other rows untouched and does not mutate the input', () => {
      const untouched = item({ id: 2, title: 'Other document' });
      const items = [item({ id: 1, status: 'failed' }), untouched];

      const result = markRetrying(items, 1);

      expect(result[1]).toBe(untouched);
      expect(result).not.toBe(items);
      expect(items[0].status).toBe('failed');
    });

    it('leaves the list unchanged when the id is absent', () => {
      const items = [item({ id: 1, status: 'failed' }), item({ id: 2 })];

      const result = markRetrying(items, 99);

      expect(result).toEqual(items);
    });
  });

  describe('toListItem', () => {
    it('maps a 202 importing document with fresh-list defaults', () => {
      expect(
        toListItem(
          document({
            id: 42,
            title: 'Fresh import',
            status: 'importing',
            current_version: null,
          }),
        ),
      ).toEqual(
        item({
          id: 42,
          title: 'Fresh import',
          status: 'importing',
          open_threads_count: 0,
          synced_at: null,
        }),
      );
    });

    it('pulls synced_at from the current version', () => {
      const result = toListItem(
        document({
          id: 1,
          current_version: version({ synced_at: '2026-07-21T12:00:00Z' }),
        }),
      );

      expect(result.synced_at).toBe('2026-07-21T12:00:00Z');
    });
  });

  describe('settleAnnouncement', () => {
    it('announces ready and failed imports exactly', () => {
      expect(settleAnnouncement({ status: 'ready', title: 'Anchoring RFC' })).toBe(
        'Import ready: Anchoring RFC',
      );
      expect(settleAnnouncement({ status: 'failed', title: 'Broken import' })).toBe(
        'Import failed: Broken import',
      );
    });

    it('does not announce an importing document', () => {
      expect(settleAnnouncement({ status: 'importing', title: 'Still importing' })).toBeNull();
    });
  });

  describe('appendItems', () => {
    it('appends a fetched page below the loaded rows in order', () => {
      const loaded = [item({ id: 5 }), item({ id: 4 })];
      const incoming = [item({ id: 3 }), item({ id: 2 }), item({ id: 1 })];

      const result = appendItems(loaded, incoming);

      expect(result.map(({ id }) => id)).toEqual([5, 4, 3, 2, 1]);
    });

    it('drops an id already loaded so a prepended or retried row never doubles', () => {
      // A live prepend (or a page window that shifts by one) can put an
      // already-shown doc into a later page; appending must dedup by id (#86).
      const loaded = [item({ id: 9, title: 'Prepended import' }), item({ id: 6 })];
      const incoming = [item({ id: 6, title: 'Stale copy' }), item({ id: 5 })];

      const result = appendItems(loaded, incoming);

      expect(result.map(({ id }) => id)).toEqual([9, 6, 5]);
      // The already-loaded row wins; the duplicate from the page is discarded.
      expect(result[1].title).toBe('Untitled');
    });

    it('does not mutate the inputs', () => {
      const loaded = [item({ id: 2 })];
      const incoming = [item({ id: 1 })];

      const result = appendItems(loaded, incoming);

      expect(loaded.map(({ id }) => id)).toEqual([2]);
      expect(incoming.map(({ id }) => id)).toEqual([1]);
      expect(result).not.toBe(loaded);
    });
  });

  describe('hasMorePages', () => {
    it('is true only while the current page is behind the last page', () => {
      expect(hasMorePages(meta({ current_page: 1, last_page: 3 }))).toBe(true);
      expect(hasMorePages(meta({ current_page: 2, last_page: 3 }))).toBe(true);
      expect(hasMorePages(meta({ current_page: 3, last_page: 3 }))).toBe(false);
    });

    it('is false for a null meta (degraded read has no pages to load)', () => {
      expect(hasMorePages(null)).toBe(false);
    });
  });

  // ---- M3.7: lifecycle filter chips + live rows under a filter (5A / 7A) -----

  describe('lifecycleParam', () => {
    it('maps All to undefined so the request omits the param (the identity)', () => {
      expect(lifecycleParam('all')).toBeUndefined();
    });

    it('passes each narrowing state through as its wire value', () => {
      expect(lifecycleParam('draft')).toBe('draft');
      expect(lifecycleParam('in_review')).toBe('in_review');
      expect(lifecycleParam('approved')).toBe('approved');
      expect(lifecycleParam('needs_attention')).toBe('needs_attention');
    });
  });

  describe('applyImport — a fresh import flips the chip to All (5A)', () => {
    it('prepends the importing row, bumps the total, AND resets the filter to All', () => {
      // Watching the Approved chip, a new import arrives (draft/importing). It must
      // not be hidden: the chip flips to All at once so the row is instantly
      // watchable. This is the OPTIMISTIC step — when a filter was active the hook
      // follows it with a refetch of the true All page 1 (reconciling the count and
      // Load more); when All was already active this IS the correct All + 1.
      const state: LiveListState = {
        items: [item({ id: 1, lifecycle_status: 'approved' })],
        meta: meta({ total: 3 }),
        filter: 'approved',
      };

      const next = applyImport(state, document({ id: 9, status: 'importing' }));

      expect(next.filter).toBe('all');
      expect(next.items.map(({ id }) => id)).toEqual([9, 1]);
      expect(next.items[0].status).toBe('importing');
      expect(next.meta?.total).toBe(4);
    });

    it('flips to All even when it was already All, and dedupes a re-imported id', () => {
      const state: LiveListState = {
        items: [item({ id: 9 }), item({ id: 1 })],
        meta: meta({ total: 2 }),
        filter: 'all',
      };

      const next = applyImport(state, document({ id: 9, status: 'importing', title: 'Re-run' }));

      expect(next.filter).toBe('all');
      // The re-imported row moves to the front without duplicating.
      expect(next.items.map(({ id }) => id)).toEqual([9, 1]);
      expect(next.items[0].title).toBe('Re-run');
      expect(next.meta?.total).toBe(3);
    });

    it('leaves a degraded (null) paginator null — no total to bump', () => {
      const state: LiveListState = { items: [], meta: null, filter: 'all' };

      const next = applyImport(state, document({ id: 9, status: 'importing' }));

      expect(next.meta).toBeNull();
      expect(next.items.map(({ id }) => id)).toEqual([9]);
    });
  });

  describe('applyFilterPage — a settled row keeps its place until refetch (5A)', () => {
    it('replaces the rows and paginator wholesale under the chosen chip', () => {
      const state: LiveListState = {
        items: [item({ id: 1 }), item({ id: 2 })],
        meta: meta({ total: 8, current_page: 1, last_page: 2 }),
        filter: 'all',
      };
      const page: DocumentListPage = {
        data: [item({ id: 5, lifecycle_status: 'approved' })],
        meta: meta({ total: 3, current_page: 1, last_page: 1 }),
      };

      const next = applyFilterPage(state, page, 'approved');

      expect(next.filter).toBe('approved');
      expect(next.items.map(({ id }) => id)).toEqual([5]);
      expect(next.meta?.total).toBe(3);
    });

    it('is the ONLY thing that drops a row settled out of the active filter', () => {
      // The narrated 5A path: viewing Draft, an importing row settles to Approved.
      // mergeSettled keeps it in place WITH its new chip (never culled on settle) —
      // it is a client refetch (applyFilterPage), not the settle, that removes it.
      const filtered: LiveListState = {
        items: [item({ id: 1, status: 'importing', lifecycle_status: 'draft' })],
        meta: meta({ total: 1 }),
        filter: 'draft',
      };

      // The settle keeps the row, now Approved — it does NOT vanish under Draft.
      const settledItems = mergeSettled(
        filtered.items,
        document({ id: 1, status: 'ready', lifecycle_status: 'approved' }),
      );
      expect(settledItems).toHaveLength(1);
      expect(settledItems[0].lifecycle_status).toBe('approved');

      // Only the next refetch (re-selecting Draft server-side) drops it.
      const refetched = applyFilterPage(
        { ...filtered, items: settledItems },
        { data: [], meta: meta({ total: 0 }) },
        'draft',
      );
      expect(refetched.items).toEqual([]);
    });
  });

  describe('nextLoadMorePage', () => {
    // The in-flight guard is the caller's loadingRef, not a param here (a batched
    // `loading` state is still false on the second click of a rapid pair), so this
    // predicate only decides whether a next page exists.
    it('returns the next page number when more pages remain', () => {
      expect(nextLoadMorePage({ meta: meta({ current_page: 1, last_page: 3 }) })).toBe(2);
    });

    it('returns null when the paginator is exhausted', () => {
      expect(nextLoadMorePage({ meta: meta({ current_page: 3, last_page: 3 }) })).toBeNull();
    });

    it('returns null when there is no meta', () => {
      expect(nextLoadMorePage({ meta: null })).toBeNull();
    });
  });
});

function document(overrides: Partial<Document> = {}): Document {
  return {
    id: 1,
    title: 'Untitled',
    status: 'importing',
    format: 'md',
    source_type: 'url',
    source_url: 'https://example.com/spec.md',
    last_sync_status: 'ok',
    sync_error: null,
    lifecycle_status: 'draft',
    current_version: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

function meta(overrides: Partial<DocumentListMeta> = {}): DocumentListMeta {
  return {
    current_page: 1,
    last_page: 1,
    per_page: 20,
    total: 20,
    ...overrides,
  };
}

function item(overrides: Partial<DocumentListItem> & { id: number }): DocumentListItem {
  return {
    title: 'Untitled',
    status: 'ready',
    last_sync_status: 'ok',
    sync_error: null,
    lifecycle_status: 'draft',
    open_threads_count: 0,
    synced_at: null,
    project: null,
    created_at: null,
    ...overrides,
  };
}

function version(
  overrides: Partial<NonNullable<Document['current_version']>> = {},
): NonNullable<Document['current_version']> {
  return {
    id: 1,
    ordinal: 1,
    content_hash: 'hash',
    content: '# Spec',
    import_warnings: [],
    mdx_ok: null,
    source_version: null,
    synced_at: null,
    ...overrides,
  };
}
