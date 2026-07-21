import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentNewVersionBanner, newerVersionNoticeFromDocument } from '@/components/app/document-new-version-banner';
import type { Document, DocumentVersion } from '@/lib/document-types';

describe('DocumentNewVersionBanner', () => {
  it('appears when a poll reports a newer current version', () => {
    const notice = newerVersionNoticeFromDocument({
      document: documentWithCurrentVersion(version({ id: 303, ordinal: 3 })),
      documentId: 42,
      viewedVersionId: 202,
    });

    expect(notice).toEqual({
      id: 303,
      label: 'v3',
      href: '/documents/42?version=303',
    });

    const html = renderToStaticMarkup(<DocumentNewVersionBanner notice={notice} />);

    expect(html).toContain('older version');
    expect(html).toContain('v3');
    expect(html).toContain('View latest');
    expect(html).toContain('href="/documents/42?version=303"');
  });

  it('does not appear when the viewed version is latest', () => {
    const notice = newerVersionNoticeFromDocument({
      document: documentWithCurrentVersion(version({ id: 303, ordinal: 3 })),
      documentId: 42,
      viewedVersionId: 303,
    });

    expect(notice).toBeNull();
    expect(renderToStaticMarkup(<DocumentNewVersionBanner notice={notice} />)).toBe('');
  });
});

function documentWithCurrentVersion(currentVersion: DocumentVersion): Document {
  return {
    id: 42,
    title: 'Review spec',
    status: 'ready',
    format: 'md',
    source_type: 'raw_url',
    source_url: 'https://example.test/spec.md',
    last_sync_status: 'ok',
    sync_error: null,
    lifecycle_status: 'in_review',
    current_version: currentVersion,
    created_at: null,
    updated_at: null,
  };
}

function version({ id, ordinal }: { id: number; ordinal: number }): DocumentVersion {
  return {
    id,
    ordinal,
    kind: 'mainline',
    parent_version_id: null,
    content_hash: `hash-${id}`,
    content: `content-${id}`,
    import_warnings: [],
    plain_text: `plain-${id}`,
    projection_version: '2',
    mdx_ok: null,
    source_version: null,
    synced_at: null,
  };
}
