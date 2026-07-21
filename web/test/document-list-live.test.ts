import { describe, expect, it } from 'vitest';
import {
  mergeSettled,
  prependItem,
  settleAnnouncement,
  shouldPoll,
  toListItem,
} from '@/lib/document-list-live';
import type { Document, DocumentListItem } from '@/lib/document-types';

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

function item(overrides: Partial<DocumentListItem> & { id: number }): DocumentListItem {
  return {
    title: 'Untitled',
    status: 'ready',
    last_sync_status: 'ok',
    sync_error: null,
    lifecycle_status: 'draft',
    open_threads_count: 0,
    synced_at: null,
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
