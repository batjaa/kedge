import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentList } from '@/components/app/document-list';
import type { DocumentListItem, DocumentListPage } from '@/lib/document-types';

// Static-markup coverage for the home document list (SPEC 11, #84): the row
// anatomy, the empty state, and the degraded "API unreachable" state. Renders
// the pure component the home server component feeds — no browser, no fetch.
describe('DocumentList', () => {
  it('renders one navigable row per document with its lifecycle, sync state, and open-thread count', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        page={pageOf([
          item({
            id: 7,
            title: 'Anchoring RFC',
            status: 'ready',
            lifecycle_status: 'in_review',
            open_threads_count: 3,
            synced_at: new Date(Date.now() - 5 * 60_000).toISOString(),
          }),
          item({
            id: 8,
            title: 'Broken import',
            status: 'failed',
            last_sync_status: 'failed',
            sync_error: 'Source unreachable',
          }),
          item({ id: 9, title: 'Still importing', status: 'importing' }),
        ])}
      />,
    );

    // Row is a real link to the review surface (a11y).
    expect(html).toContain('href="/documents/7"');
    expect(html).toContain('href="/documents/8"');
    expect(html).toContain('href="/documents/9"');
    expect(html).toContain('Anchoring RFC');

    // Lifecycle chip (amber for in-review), rendered as the mono chip idiom.
    expect(html).toContain('in review');

    // Last-sync state per import status.
    expect(html).toContain('synced 5m ago');
    expect(html).toContain('Import failed');
    expect(html).toContain('Importing');

    // Open-thread count with its screen-reader label.
    expect(html).toContain('>3<');
    expect(html).toContain('open threads');

    // DESIGN.md panel anatomy: divide-y rows in a rounded-2xl hairline card,
    // and the a11y focus ring the mockup omits.
    expect(html).toContain('rounded-2xl');
    expect(html).toContain('divide-y');
    expect(html).toContain('focus-visible:ring-emerald-500');
  });

  it('shows an empty state that points back at the import box', () => {
    const html = renderToStaticMarkup(<DocumentList page={pageOf([])} />);

    expect(html).toContain('No documents yet');
    expect(html).toContain('box above');
    // No rows.
    expect(html).not.toContain('href="/documents/');
  });

  it('degrades the list area alone to the StatePanel when the fetch fails', () => {
    // page === null models a non-200 read (API down or a mid-rollout 404). The
    // home renders the import box as a sibling unconditionally; only this area
    // falls back — the page never 500s over the list.
    const html = renderToStaticMarkup(<DocumentList page={null} />);

    expect(html).toContain('load your documents');
    expect(html).toContain('unreachable');
    expect(html).not.toContain('href="/documents/');
  });
});

function pageOf(data: DocumentListItem[]): DocumentListPage {
  return {
    data,
    meta: { current_page: 1, last_page: 1, per_page: 20, total: data.length },
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
