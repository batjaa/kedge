import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentReviewHeader } from '@/components/app/document-review-header';

describe('DocumentReviewHeader', () => {
  it('renders active approvals with stale version markers', () => {
    const html = renderToStaticMarkup(
      <DocumentReviewHeader
        title="Review spec"
        surfaceLabel="Authenticated document"
        lifecycleStatus="in_review"
        versionLabel="v5"
        syncedAt={null}
        openThreadCount={2}
        approvals={[
          {
            id: 10,
            user: { id: 7, name: 'Ada Lovelace' },
            document_version_id: 3,
            version_label: 'v3',
            stale: true,
            created_at: '2026-07-20T18:00:00Z',
          },
          {
            id: 11,
            user: { id: 8, name: 'Grace Hopper' },
            document_version_id: 5,
            version_label: 'v5',
            stale: false,
            created_at: '2026-07-20T18:05:00Z',
          },
        ]}
      />,
    );

    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('approved v3 · current v5');
    expect(html).toContain('Grace Hopper');
    expect(html).toContain('approved v5');
  });

  it('uses the current version label for stale approvals while viewing an old version', () => {
    const html = renderToStaticMarkup(
      <DocumentReviewHeader
        title="Review spec"
        surfaceLabel="Authenticated document"
        lifecycleStatus="in_review"
        versionLabel="v1"
        currentVersionLabel="v3"
        syncedAt={null}
        openThreadCount={2}
        approvals={[
          {
            id: 10,
            user: { id: 7, name: 'Ada Lovelace' },
            document_version_id: 1,
            version_label: 'v1',
            stale: true,
            created_at: '2026-07-20T18:00:00Z',
          },
        ]}
      />,
    );

    expect(html).toContain('approved v1 · current v3');
  });
});
