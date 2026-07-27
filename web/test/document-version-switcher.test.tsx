import { renderToStaticMarkup } from './render-intl';
import { describe, expect, it } from 'vitest';
import { DocumentVersionSwitcher } from '@/components/app/document-version-switcher';
import type { DocumentVersion } from '@/lib/document-types';

describe('DocumentVersionSwitcher', () => {
  it('renders versions by ordinal and marks the viewed version', () => {
    const html = renderToStaticMarkup(
      <DocumentVersionSwitcher
        documentId={42}
        viewedVersionId={202}
        currentVersionId={303}
        versions={[
          version({ id: 101, ordinal: 1 }),
          version({ id: 202, ordinal: 2 }),
          version({ id: 303, ordinal: 3 }),
        ]}
      />,
    );

    expect(html).toContain('v1');
    expect(html).toContain('v2');
    expect(html).toContain('v3');
    expect(html).toContain('(latest)');
    expect(html).toContain('href="/documents/42?version=202"');
    expect(html).toContain('href="/documents/42/diff?a=202&amp;b=303"');
    expect(html).toContain('aria-current="page"');
  });

  it('compares the current version against the previous version by default', () => {
    const html = renderToStaticMarkup(
      <DocumentVersionSwitcher
        documentId={42}
        viewedVersionId={303}
        currentVersionId={303}
        versions={[
          version({ id: 101, ordinal: 1 }),
          version({ id: 202, ordinal: 2 }),
          version({ id: 303, ordinal: 3 }),
        ]}
      />,
    );

    expect(html).toContain('href="/documents/42/diff?a=202&amp;b=303"');
  });
});

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
