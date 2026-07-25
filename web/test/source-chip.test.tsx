import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SourceChip } from '@/components/app/source-chip';
import type { DocumentSource } from '@/lib/document-types';

// The provenance chip (M3.10 #117, SPEC §11) — the display-ready `source`
// descriptor rendered per kind, left-truncated to keep the filename visible with
// the full value on hover, and perceivable as text without vision (story 8). The
// derivation itself lives (and is matrix-tested) server-side; this asserts the
// render contract the web owns.
describe('SourceChip', () => {
  const render = (source: DocumentSource) => renderToStaticMarkup(<SourceChip source={source} />);

  it('renders a repo doc as its repo-relative path, truncatable, full value on hover', () => {
    const html = render({ kind: 'repo', path: 'docs/rfcs/017-anchoring.md' });

    expect(html).toContain('docs/rfcs/017-anchoring.md');
    // The full path rides a title for hover disclosure…
    expect(html).toContain('title="docs/rfcs/017-anchoring.md"');
    // …and the value is left-truncated (rtl container + truncate), so the
    // basename stays visible while the leading segments clip.
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('truncate');
  });

  it('renders a standalone GitHub import as owner/repo · path', () => {
    const html = render({ kind: 'github', repo: 'kedgehq/kedge', path: 'docs/spec.md' });

    expect(html).toContain('kedgehq/kedge · docs/spec.md');
    expect(html).toContain('title="kedgehq/kedge · docs/spec.md"');
    // The whole value is left-truncatable; the filename end stays visible.
    expect(html).toContain('dir="rtl"');
  });

  it('renders a raw-URL import as its source host (short, not truncated)', () => {
    const html = render({ kind: 'url', host: 'raw.example.test' });

    expect(html).toContain('raw.example.test');
    // A host is short and low-signal — rendered whole, no rtl truncation dance.
    expect(html).not.toContain('dir="rtl"');
  });

  it('renders an upload as the "pasted" label', () => {
    const html = render({ kind: 'upload' });

    expect(html).toContain('pasted');
    expect(html).not.toContain('dir="rtl"');
  });

  it('announces the value with a "Source:" context for assistive tech (story 8)', () => {
    const html = render({ kind: 'repo', path: 'docs/adr/0001.md' });

    // An sr-only prefix names what the value is, so a screen-reader hears
    // "Source: docs/adr/0001.md" rather than an orphan path. The DOM carries the
    // whole path as text (CSS truncates the RENDERING only), so it is read in full.
    expect(html).toContain('sr-only');
    expect(html).toContain('Source:');
    expect(html).toContain('docs/adr/0001.md');
  });

  it('renders the neutral mono chip idiom — no status hue (provenance is metadata)', () => {
    const html = render({ kind: 'repo', path: 'docs/spec.md' });

    // DESIGN.md chip: mono + neutral zinc tint. It must borrow no status color
    // (no emerald/amber/rose), since provenance is metadata, not status.
    expect(html).toContain('font-mono');
    expect(html).toContain('bg-zinc-400/10');
    expect(html).not.toMatch(/emerald|amber|rose/);
  });

  it('renders nothing for a degenerate URL with no host (never an empty crash)', () => {
    // The server never ships this shape for a real raw URL, but the renderer must
    // degrade to no chip rather than an empty/broken one (untrusted-input rule).
    expect(render({ kind: 'url' })).toBe('');
  });
});
