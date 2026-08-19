import { renderToStaticMarkup } from './render-intl';
import { describe, expect, it } from 'vitest';
import {
  DocumentVersionSwitcher,
  VISIBLE_VERSION_LIMIT,
} from '@/components/app/document-version-switcher';
import type { DocumentVersion } from '@/lib/document-types';
import { formatShortDate } from '@/lib/intl-time';

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

  describe('no collapse', () => {
    it('renders every pill at the limit', () => {
      const versions = ladder(VISIBLE_VERSION_LIMIT);
      const html = render(versions, latestId(versions));

      expect(pillIds(html)).toEqual(versions.map((v) => v.id));
      expect(menuIds(html)).toEqual([]);
      expect(html).not.toContain('<details');
      expect(html).not.toContain('older');
    });

    it('renders every pill one past the limit, where collapsing would hide exactly one', () => {
      const versions = ladder(VISIBLE_VERSION_LIMIT + 1);
      const html = render(versions, latestId(versions));

      expect(pillIds(html)).toHaveLength(VISIBLE_VERSION_LIMIT + 1);
      expect(pillIds(html)).toEqual(versions.map((v) => v.id));
      expect(menuIds(html)).toEqual([]);
      expect(html).not.toContain('<details');
    });
  });

  describe('collapse', () => {
    it('collapses as soon as two versions would be hidden', () => {
      const versions = ladder(VISIBLE_VERSION_LIMIT + 2);
      const html = render(versions, latestId(versions));

      expect(pillIds(html)).toEqual(versions.slice(-VISIBLE_VERSION_LIMIT).map((v) => v.id));
      // Newest first, and every hidden version is reachable.
      expect(menuIds(html)).toEqual([2, 1]);
      expect(html).toContain('+2 older');
    });

    it('caps the strip at the limit and keeps the trigger count equal to the menu length', () => {
      const versions = ladder(12);
      const html = render(versions, latestId(versions));

      expect(pillIds(html)).toHaveLength(VISIBLE_VERSION_LIMIT);
      expect(pillIds(html)).toEqual([10, 11, 12]);
      expect(menuIds(html)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
      expect(html).toContain(`+${12 - VISIBLE_VERSION_LIMIT} older`);
      expect(menuIds(html)).toHaveLength(12 - VISIBLE_VERSION_LIMIT);
    });

    it('lists menu entries as real ?version= links carrying label and created date', () => {
      const versions = ladder(12);
      const html = render(versions, latestId(versions));

      expect(html).toContain('href="/documents/42?version=1"');
      expect(html).toContain('href="/documents/42?version=9"');
      expect(menuEntry(html, 1)).toContain('v1');
      expect(menuEntry(html, 1)).toContain(formatShortDate(versions[0].synced_at, 'en-US'));
    });

    it('keeps the disclosure keyboard reachable and labelled', () => {
      const html = render(ladder(12), 12);

      expect(html).toContain('<details');
      expect(html).toContain('<summary');
      expect(html).toContain('aria-label="Show 9 older versions"');
      expect(html).toContain('aria-label="Older versions"');
    });

    it('translates the trigger on the active locale', () => {
      const versions = ladder(12);
      const html = renderToStaticMarkup(
        <DocumentVersionSwitcher
          documentId={42}
          viewedVersionId={12}
          currentVersionId={12}
          versions={versions}
        />,
        'de-DE',
      );

      expect(html).toContain('+9 ältere');
      expect(html).toContain('aria-label="9 ältere Versionen anzeigen"');
    });
  });

  describe('latest tag placement', () => {
    it('rides the latest pill, which is always visible', () => {
      const versions = ladder(25);
      const html = render(versions, 25);

      expect(pillIds(html)).toContain(25);
      expect(pill(html, 25)).toContain('(latest)');
      expect(pill(html, 24)).not.toContain('(latest)');
      expect(occurrences(html, '(latest)')).toBe(1);
    });

    it('pins the current version onto the strip even when it sorts outside the window', () => {
      const versions = ladder(12);
      // Pathological but defended: the current version is not the last row.
      const html = render(versions, 2);

      expect(pillIds(html)).toEqual([2, 10, 11, 12]);
      expect(pill(html, 2)).toContain('(latest)');
      // The trigger still counts every out-of-window version.
      expect(menuIds(html)).toHaveLength(9);
    });
  });

  describe('viewed old version', () => {
    it('renders the viewed version as an extra visible pill carrying aria-current', () => {
      const versions = ladder(12);
      const html = render(versions, 12, 2);

      expect(pillIds(html)).toEqual([2, 10, 11, 12]);
      expect(pill(html, 2)).toContain('aria-current="page"');
      expect(occurrences(html, 'aria-current="page"')).toBe(1);
    });

    it('never hides aria-current inside the menu', () => {
      const html = render(ladder(50), 50, 1);

      expect(menuEntry(html, 1)).not.toContain('aria-current');
      expect(pill(html, 1)).toContain('aria-current="page"');
      // Still reachable in the menu, and the count stays honest.
      expect(menuIds(html)).toHaveLength(47);
      expect(html).toContain('+47 older');
      expect(menuEntry(html, 1)).toContain('(viewing)');
    });

    it('leaves the compare pill alone', () => {
      const html = render(ladder(12), 12, 2);

      expect(html).toContain('href="/documents/42/diff?a=2&amp;b=12"');
      expect(html).toContain('Compare');
    });
  });
});

function render(versions: DocumentVersion[], currentVersionId: number, viewedVersionId?: number) {
  return renderToStaticMarkup(
    <DocumentVersionSwitcher
      documentId={42}
      viewedVersionId={viewedVersionId ?? currentVersionId}
      currentVersionId={currentVersionId}
      versions={versions}
    />,
  );
}

/** `count` mainline versions, ascending, ids and ordinals both 1..count. */
function ladder(count: number): DocumentVersion[] {
  return Array.from({ length: count }, (_, index) =>
    version({
      id: index + 1,
      ordinal: index + 1,
      syncedAt: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
    }),
  );
}

function latestId(versions: DocumentVersion[]): number {
  return versions[versions.length - 1].id;
}

function pillIds(html: string): number[] {
  return [...html.matchAll(/data-version-pill="(\d+)"/g)].map((match) => Number(match[1]));
}

function menuIds(html: string): number[] {
  return [...html.matchAll(/data-version-item="(\d+)"/g)].map((match) => Number(match[1]));
}

function pill(html: string, id: number): string {
  return anchor(html, `data-version-pill="${id}"`);
}

function menuEntry(html: string, id: number): string {
  return anchor(html, `data-version-item="${id}"`);
}

/** The one `<a>…</a>` carrying `marker` — anchors never nest, so this is exact. */
function anchor(html: string, marker: string): string {
  const found = html.match(new RegExp(`<a [^>]*${marker}[^>]*>.*?</a>`));
  expect(found, `no anchor with ${marker}`).not.toBeNull();

  return found![0];
}

function occurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

function version({
  id,
  ordinal,
  syncedAt = null,
}: {
  id: number;
  ordinal: number;
  syncedAt?: string | null;
}): DocumentVersion {
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
    synced_at: syncedAt,
  };
}
