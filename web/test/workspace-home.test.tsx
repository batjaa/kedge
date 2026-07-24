import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentListItem,
  DocumentListPage,
  WorkspaceSummary,
} from '@/lib/document-types';

// ImportForm calls useRouter, and there is no app-router context under
// renderToStaticMarkup — stub next/navigation. We only assert static markup here
// (effects, polling, and submit flow are covered in document-list-live.test.ts).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

// Import AFTER the mock is registered so ImportForm binds the stubbed router.
const { WorkspaceHome } = await import('@/components/app/workspace-home');

describe('WorkspaceHome', () => {
  it('renders BOTH halves on a degraded read: the import box AND the StatePanel (3A)', () => {
    // A null page 1 is the server-side degraded read. The whole spec line: the
    // import box still renders (the home never 500s over the list) while only the
    // list area falls back to the "API unreachable" panel.
    const html = renderToStaticMarkup(<WorkspaceHome initialPage={null} />);

    // Half one — the import box is present and usable.
    expect(html).toContain('Import a document');
    expect(html).toContain('Document URL');

    // Half two — the list area degrades to the StatePanel idiom, alone.
    expect(html).toContain('load your documents');
    expect(html).toContain('unreachable');
    // Not the empty state (that is the healthy zero-docs case, not degraded).
    expect(html).not.toContain('No documents yet');
  });

  it('derives the count chip from meta.total, not the loaded row count', () => {
    // meta is the single source of truth: a first page shows 1 of 40 rows, and the
    // chip must read 40 (meta.total), never items.length (1) — the divergence the
    // dropped `total` state used to cause (C1).
    const html = renderToStaticMarkup(<WorkspaceHome initialPage={page()} />);

    // The mono MetaChip renders its child bare, so >40< proves the chip value.
    expect(html).toContain('>40<');
    expect(html).not.toContain('>1<');
  });

  it('renders the stats strip from a seeded summary (M3.7)', () => {
    const html = renderToStaticMarkup(
      <WorkspaceHome initialPage={page()} initialSummary={summary()} />,
    );

    // Strip-only stat labels — proof it read the seed (not the list heading).
    expect(html).toContain('open threads');
    expect(html).toContain('approvals stale');
  });

  it('leaves the list rendering when the summary seed failed — strip absent, list intact (A1)', () => {
    // A null summary degrades the strip to nothing; the documents list is never
    // blocked by a summary outage.
    const html = renderToStaticMarkup(
      <WorkspaceHome initialPage={page()} initialSummary={null} />,
    );

    // No strip labels leak, but the list (its count chip) still renders.
    expect(html).not.toContain('approvals stale');
    expect(html).toContain('>40<');
  });
});

function summary(): WorkspaceSummary {
  return {
    documents: {
      total: 8,
      importing: 1,
      needs_attention: 2,
      lifecycle: { draft: 3, in_review: 2, approved: 3, superseded: 0 },
    },
    threads: { open: 12, orphaned: 1 },
    approvals: { stale: 2 },
  };
}

function page(): DocumentListPage {
  return {
    data: [item({ id: 5, title: 'One of forty' })],
    meta: { current_page: 1, last_page: 2, per_page: 20, total: 40 },
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
