import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentList } from '@/components/app/document-list';
import type { DocumentListItem, Project, WorkspaceSummary } from '@/lib/document-types';

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

  it('offers BOTH retry and reconnect on a dead-PAT failed row (additive, like ImportFailed)', () => {
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

    // A dead PAT surfaces the reconnect link (SPEC §19) ADDITIONALLY — but Retry
    // stays, matching the doc page's ImportFailed: a user who has since reconnected
    // must still be able to re-run the import from the row, not hit a Settings-only
    // dead end.
    expect(html).toContain('GitHub access was revoked. Reconnect the integration in Settings.');
    expect(html).toContain('Reconnect GitHub');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('Retry import');
    expect(html).toContain('<button');
  });

  it('flags a ready doc whose re-sync failed instead of rendering it healthy', () => {
    // A ready document with last_sync_status "failed" (a later re-sync broke): the
    // row must carry the failure, not the emerald healthy treatment — the doc page
    // shows a failure banner for the same state (C2).
    const html = renderToStaticMarkup(
      <DocumentList
        items={[
          item({
            id: 11,
            title: 'Re-sync broke',
            status: 'ready',
            last_sync_status: 'failed',
            sync_error: 'Source returned 500 on re-sync.',
            synced_at: new Date(Date.now() - 60_000).toISOString(),
          }),
        ]}
        total={1}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
      />,
    );

    expect(html).toContain('Sync failed');
    // The error rides a title attribute for hover disclosure.
    expect(html).toContain('title="Source returned 500 on re-sync."');
    // Rose treatment, not the healthy emerald dot / "synced" label.
    expect(html).toContain('bg-rose-500');
    expect(html).not.toContain('synced 1m ago');
  });

  it('spins an importing row (DocumentPoller treatment), not a static dot', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[item({ id: 9, title: 'Still importing', status: 'importing' })]}
        total={1}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
      />,
    );

    expect(html).toContain('Importing');
    // The spinner shares DocumentPoller's markup.
    expect(html).toContain('animate-spin');
    expect(html).toContain('border-t-emerald-500');
  });

  it('keeps the failure signal visible when degraded but this session has rows', () => {
    // degraded with rows: the StatePanel yields to the live prepends, so a slim
    // inline warning must keep the failure visible (a large workspace could
    // otherwise look like only this session's imports) (C2).
    const html = renderToStaticMarkup(
      <DocumentList
        items={[item({ id: 3, title: 'This session import' })]}
        total={1}
        degraded={true}
        announcement=""
        onSettled={noop}
        onRetried={noop}
      />,
    );

    // Rows still render…
    expect(html).toContain('href="/documents/3"');
    // …with the inline warning above them, not the full StatePanel.
    expect(html).toContain('showing only this session');
    expect(html).toContain('Refresh to see everything');
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

  // ---- M3.6: grouping, the project chip, and the project-page states --------

  it('groups the home by project — headers alphabetical, Unfiled last (14A)', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[
          item({ id: 1, title: 'Unfiled doc', project: null }),
          item({ id: 2, title: 'Zebra doc', project: { id: 20, name: 'Zebra' } }),
          item({ id: 3, title: 'Anchor doc', project: { id: 10, name: 'Anchoring' } }),
        ]}
        total={3}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
        projects={projects()}
        grouped
      />,
    );

    // Header order: Anchoring, then Zebra, then Unfiled (14A). Match on
    // header-specific markup — the row chips' <option>s also say "Unfiled".
    const anchoring = html.indexOf('href="/projects/10"');
    const zebra = html.indexOf('href="/projects/20"');
    const unfiled = html.indexOf('>Unfiled</h3>');
    expect(anchoring).toBeGreaterThan(-1);
    expect(zebra).toBeGreaterThan(anchoring);
    expect(unfiled).toBeGreaterThan(zebra);
  });

  it('carries a project chip selector on each row when the workspace has projects', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[item({ id: 7, title: 'Anchoring RFC', project: { id: 10, name: 'Anchoring' } })]}
        total={1}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
        projects={projects()}
        grouped
      />,
    );

    // The chip is a labelled selector — the reserved slot filled AND the
    // assignment affordance. It offers Unfiled + every project.
    expect(html).toContain('aria-label="Project for Anchoring RFC"');
    expect(html).toContain('>Unfiled<');
    expect(html).toContain('>Anchoring<');
    expect(html).toContain('>Zebra<');
    // The row's own project (Anchoring, id 10) is the selected option.
    expect(html).toContain('value="10"');
  });

  it('renders no chips and no headers when the workspace has no projects (looks like today)', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[item({ id: 1, title: 'Only doc', project: null })]}
        total={1}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
        projects={[]}
        grouped
      />,
    );

    // No selector, no "Unfiled" header — a single implicit group (14A).
    expect(html).not.toContain('aria-label="Project for');
    expect(html).not.toContain('>Unfiled<');
    // Still one navigable row.
    expect(html).toContain('href="/documents/1"');
  });

  it('renders a project page as a flat list with a custom heading (no group headers)', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[
          item({ id: 1, title: 'One', project: { id: 10, name: 'Anchoring' } }),
          item({ id: 2, title: 'Two', project: { id: 10, name: 'Anchoring' } }),
        ]}
        total={2}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
        projects={projects()}
        heading="Documents"
      />,
    );

    expect(html).toContain('Documents');
    expect(html).toContain('href="/documents/1"');
    expect(html).toContain('href="/documents/2"');
    // Flat: no project group header links back to the project page.
    expect(html).not.toContain('href="/projects/10"');
  });

  // ---- M3.10: the provenance chip on the row (#117, SPEC §11) ---------------

  it('carries the provenance chip on every home row, independent of projects', () => {
    // A workspace with NO projects (so no project chip) still shows provenance —
    // the source chip is not gated on projects (#117: "appears everywhere").
    const html = renderToStaticMarkup(
      <DocumentList
        items={[
          item({ id: 1, title: 'Repo doc', source: { kind: 'repo', path: 'docs/rfcs/017-anchoring.md' } }),
          item({ id: 2, title: 'Pasted note', source: { kind: 'upload' } }),
        ]}
        total={2}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
        projects={[]}
        grouped
      />,
    );

    // The repo doc's path chip (full value on hover) and the pasted label both
    // land in the rows, and each is announced with its "Source:" context.
    expect(html).toContain('title="docs/rfcs/017-anchoring.md"');
    expect(html).toContain('docs/rfcs/017-anchoring.md');
    expect(html).toContain('pasted');
    expect(html).toContain('Source:');
    // No project chip on a project-less workspace, but provenance still shows.
    expect(html).not.toContain('aria-label="Project for');
  });

  it('shows the provenance chip on a project page row too (shared row anatomy)', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[
          item({
            id: 1,
            title: 'Standalone import',
            source: { kind: 'github', repo: 'kedgehq/kedge', path: 'docs/spec.md' },
            project: { id: 10, name: 'Anchoring' },
          }),
        ]}
        total={1}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
        projects={projects()}
        heading="Documents"
      />,
    );

    // owner/repo · path, with the full value on hover.
    expect(html).toContain('kedgehq/kedge · docs/spec.md');
    expect(html).toContain('title="kedgehq/kedge · docs/spec.md"');
  });

  // ---- M3.7: the lifecycle filter chips (#103, decisions 5A/7A/A1) ----------

  it('renders the lifecycle chips with counts from the summary and marks the active one', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[item({ id: 1, lifecycle_status: 'in_review' })]}
        total={8}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
        filter="in_review"
        onSelectFilter={noop}
        summary={summary()}
      />,
    );

    // Every chip, in the mockup's order, each carrying its summary count (7A).
    expect(html).toContain('All');
    expect(html).toContain('· 8'); // documents.total
    expect(html).toContain('In review');
    expect(html).toContain('· 2'); // lifecycle.in_review
    expect(html).toContain('Approved');
    expect(html).toContain('· 3'); // lifecycle.approved
    expect(html).toContain('Draft');
    expect(html).toContain('Needs attention');
    expect(html).toContain('· 4'); // documents.needs_attention

    // The active chip is pressed (aria-pressed="true"); it is a real button group.
    expect(html).toContain('aria-label="Filter documents by lifecycle"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('focus-visible:ring-emerald-500');
  });

  it('keeps the chips (and filtering) but drops the counts when the summary is null (A1)', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[item({ id: 1 })]}
        total={1}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
        filter="all"
        onSelectFilter={noop}
        summary={null}
      />,
    );

    // The chips still render and still filter…
    expect(html).toContain('aria-label="Filter documents by lifecycle"');
    expect(html).toContain('Needs attention');
    // …but with no counts (no "· N" segments) since the summary is unavailable.
    expect(html).not.toContain('·');
  });

  it('renders NO chips on a surface that does not pass onSelectFilter (a project page)', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[item({ id: 1 })]}
        total={1}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
      />,
    );

    expect(html).not.toContain('aria-label="Filter documents by lifecycle"');
  });

  it('hides the chips on a brand-new empty workspace, so the empty state reads clean', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[]}
        total={0}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
        filter="all"
        onSelectFilter={noop}
        summary={emptySummary()}
      />,
    );

    // No rows and the All chip active → nothing to filter → no chip row, and the
    // empty state still teaches the entry point.
    expect(html).not.toContain('aria-label="Filter documents by lifecycle"');
    expect(html).toContain('No documents yet');
  });

  it('keeps the chips visible when a non-All filter narrows to zero rows (the way back)', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[]}
        total={0}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
        filter="approved"
        onSelectFilter={noop}
        summary={summary()}
      />,
    );

    // An active Approved chip that matched nothing must still show all chips so the
    // user can switch back to All — the empty state is fine underneath.
    expect(html).toContain('aria-label="Filter documents by lifecycle"');
    expect(html).toContain('No documents yet');
  });

  it('shows the project-page empty state pointing at import and assignment', () => {
    const html = renderToStaticMarkup(
      <DocumentList
        items={[]}
        total={0}
        degraded={false}
        announcement=""
        onSettled={noop}
        onRetried={noop}
        emptyTitle="No documents in this project yet"
        emptyBody="Import one with the box above, or assign an existing document from its review header or the project chip on any home row."
      />,
    );

    expect(html).toContain('No documents in this project yet');
    expect(html).toContain('box above');
    expect(html).toContain('assign an existing document');
    expect(html).not.toContain('href="/documents/');
  });
});

function projects(): Project[] {
  return [
    { id: 10, name: 'Anchoring', slug: 'anchoring', description: null, created_at: null },
    { id: 20, name: 'Zebra', slug: 'zebra', description: null, created_at: null },
  ];
}

function summary(): WorkspaceSummary {
  return {
    documents: {
      total: 8,
      importing: 1,
      needs_attention: 4,
      lifecycle: { draft: 1, in_review: 2, approved: 3, superseded: 0 },
    },
    threads: { open: 12, orphaned: 1 },
    approvals: { stale: 2 },
  };
}

function emptySummary(): WorkspaceSummary {
  return {
    documents: {
      total: 0,
      importing: 0,
      needs_attention: 0,
      lifecycle: { draft: 0, in_review: 0, approved: 0, superseded: 0 },
    },
    threads: { open: 0, orphaned: 0 },
    approvals: { stale: 0 },
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
    source: { kind: 'upload' },
    tracked_repo_id: null,
    created_at: null,
    ...overrides,
  };
}
