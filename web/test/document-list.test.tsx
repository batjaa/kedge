import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentList } from '@/components/app/document-list';
import type { DocumentListItem } from '@/lib/document-types';

// Static-markup coverage for the home document list (SPEC 11): the row anatomy,
// the empty state, the degraded "API unreachable" state, and the polite live
// region (10A). Renders the live client island with fixed props — no browser, no
// poll (effects don't run under renderToStaticMarkup). The prepend/settle/poll
// LOGIC is unit-tested purely in document-list-live.test.ts.
describe('DocumentList', () => {
  const noop = () => {};

  it('renders one navigable row per document with its lifecycle, sync state, and open-thread count', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[
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
        ]}
        total={3}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
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

    // The polite live region is always present (10A), so assistive tech watches
    // it across settles even when it starts empty.
    expect(html).toContain('aria-live="polite"');

    // DESIGN.md panel anatomy: divide-y rows in a rounded-2xl hairline card,
    // and the a11y focus ring the mockup omits.
    expect(html).toContain('rounded-2xl');
    expect(html).toContain('divide-y');
    expect(html).toContain('focus-visible:ring-emerald-500');
  });

  it('announces a settle through the polite live region', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[item({ id: 1, title: 'Anchoring RFC', status: 'ready' })]}
        total={1}
        degraded={false}
        announcement="Import ready: Anchoring RFC"
        onSettled={noop}
        onRetried={noop}
      />,
    );

    expect(html).toContain('Import ready: Anchoring RFC');
  });

  it('shows an empty state that points back at the import box', () => {
    const html = renderToStaticMarkup(
      <DocumentList items={[]} total={0} degraded={false} announcement="" onSettled={noop} onRetried={noop} />,
    );

    expect(html).toContain('No documents yet');
    expect(html).toContain('box above');
    // No rows.
    expect(html).not.toContain('href="/documents/');
  });

  it('offers inline Retry on a transient failed row — the shared affordance, no reconnect link', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[
          item({
            id: 8,
            title: 'Broken import',
            status: 'failed',
            last_sync_status: 'failed',
            sync_error: 'URL not allowed (private address).',
          }),
        ]}
        total={1}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
      />,
    );

    // The import error is shown on the row, and a real focusable Retry button
    // with the standard emerald focus ring (copy identical to the doc page).
    expect(html).toContain('URL not allowed (private address).');
    expect(html).toContain('Retry import');
    expect(html).toContain('<button');
    expect(html).toContain('focus-visible:ring-emerald-500');
    // A transient failure is on the retry path — no reconnect CTA.
    expect(html).not.toContain('Reconnect GitHub');
    expect(html).not.toContain('href="/settings"');
  });

  it('offers reconnect (not a futile retry) on a dead-PAT failed row', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[
          item({
            id: 8,
            title: 'Revoked token',
            status: 'failed',
            last_sync_status: 'failed',
            sync_error: 'GitHub access was revoked. Reconnect the integration in Settings.',
          }),
        ]}
        total={1}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
      />,
    );

    // A dead PAT can't heal on retry (SPEC §19): reconnect link to Settings, and
    // NO retry action at all — mutually exclusive with the transient branch.
    expect(html).toContain('GitHub access was revoked. Reconnect the integration in Settings.');
    expect(html).toContain('Reconnect GitHub');
    expect(html).toContain('href="/settings"');
    expect(html).not.toContain('Retry import');
    expect(html).not.toContain('<button');
  });

  it('degrades the list area alone to the StatePanel when the fetch fails', () => {
    // degraded models a non-200 read (API down or a mid-rollout 404). The home
    // renders the import box as a sibling unconditionally; only this area falls
    // back — the page never 500s over the list.
    const html = renderToStaticMarkup(
      <DocumentList items={[]} total={0} degraded={true} announcement="" onSettled={noop} onRetried={noop} />,
    );

    expect(html).toContain('load your documents');
    expect(html).toContain('unreachable');
    expect(html).not.toContain('href="/documents/');
  });

  it('shows the Load more control when the paginator has a further page', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[item({ id: 1 })]}
        total={40}
        degraded={false}
        announcement=""
        onSettled={noop}
        hasMore={true}
        loadingMore={false}
        onLoadMore={noop}
        onRetried={noop}
      />,
    );

    expect(html).toContain('Load more');
    // House "Load more threads" idiom: the secondary rounded-full button.
    expect(html).toContain('rounded-full');
    // Enabled while idle — the disabled attribute is absent (the class carries
    // the `disabled:` variants unconditionally, so match the attribute, not text).
    expect(html).not.toContain('disabled=""');
  });

  it('hides the Load more control when no further page exists', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[item({ id: 1 })]}
        total={1}
        degraded={false}
        announcement=""
        onSettled={noop}
        hasMore={false}
        loadingMore={false}
        onLoadMore={noop}
        onRetried={noop}
      />,
    );

    expect(html).not.toContain('Load more');
  });

  it('shows a loading, disabled Load more button while a page fetch is in flight', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[item({ id: 1 })]}
        total={40}
        degraded={false}
        announcement=""
        onSettled={noop}
        hasMore={true}
        loadingMore={true}
        onLoadMore={noop}
        onRetried={noop}
      />,
    );

    expect(html).toContain('Loading');
    expect(html).toContain('disabled=""');
  });
});

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
