import { renderToStaticMarkup } from './render-intl';
import { describe, expect, it } from 'vitest';
import { DocumentReviewSidebar } from '@/components/app/document-review-sidebar';
import type { TocEntry } from '@/lib/review-surface-layout';

// The #146 regression seam. The bug was purely STRUCTURAL, not visual: the
// sticky box declared `sticky top-32` correctly but sat inside a bare, auto-
// height <aside>, so its containing block was exactly its own height — zero
// slack — and the whole sidebar scrolled off with a long document. The fix is
// that the sticky box IS the root, so its containing block is the stretched
// `w-72` flex column in DocumentReviewSurface.
//
// That distinction is invisible to a class-name check on "some element in the
// tree", which is why these assertions are anchored to the ROOT element: they
// fail the moment anyone re-wraps the sticky box in a height-less parent, which
// is the only way this bug comes back. The pinning itself is proven in a real
// browser (a sticky element has no observable geometry in jsdom/static markup).

const TOC: TocEntry[] = [
  { id: 'problem', title: '1. Problem', level: 2 },
  { id: 'architecture', title: '4. Architecture', level: 2 },
  { id: 'stack', title: '4.1 Stack', level: 3 },
];

function render(): string {
  return renderToStaticMarkup(
    <DocumentReviewSidebar
      tocEntries={TOC}
      activeHeadingId="architecture"
      threads={[]}
      activeThreadId={null}
      lifecycleStatus="in_review"
      versionLabel="v5"
      onJumpToHeading={() => {}}
      onFocusThread={() => {}}
      onCollapse={() => {}}
    />,
  );
}

/** The attributes of the opening tag of the rendered root — anything nested is out of reach. */
function rootAttributes(html: string): string {
  const match = /^<aside\b([^>]*)>/.exec(html);
  if (!match) {
    throw new Error(`expected the sidebar root to be an <aside>, got: ${html.slice(0, 120)}`);
  }
  return match[1];
}

function rootClassList(html: string): string[] {
  const match = /\bclass="([^"]*)"/.exec(rootAttributes(html));
  if (!match) {
    throw new Error(`expected the sidebar root to carry classes, got: ${html.slice(0, 120)}`);
  }
  return match[1].split(' ');
}

describe('DocumentReviewSidebar', () => {
  it('makes the sticky box the root element so it has travel inside the review column', () => {
    const classes = rootClassList(render());

    expect(classes).toContain('sticky');
    expect(classes).toContain('top-32');
  });

  it('keeps the internal scroll on that same root, so a tall sidebar scrolls itself', () => {
    const classes = rootClassList(render());

    expect(classes).toContain('overflow-y-auto');
    expect(classes.some((cls) => cls.startsWith('max-h-'))).toBe(true);
  });

  it('leaves the w-72 column measure to the surface — the sidebar sets no width', () => {
    // The prose measure (52rem) and the rail grid are the surface's business;
    // a width here would fight the flex column and reintroduce horizontal shift.
    const classes = rootClassList(render());

    expect(classes.some((cls) => /^(w|min-w|max-w)-/.test(cls))).toBe(false);
  });

  it('marks that root with the data hook the sticky journey selects on', () => {
    // e2e/sticky-sidebar.spec.ts reads the pinned offset off this element. A
    // locale-dependent selector (the nav's aria-label) would break under M3.9's
    // negotiated locales, and `aside` alone also matches the thread rail.
    expect(rootAttributes(render())).toContain('data-review-sidebar');
  });

  it('still renders both nav groups and the collapse control', () => {
    const html = render();

    expect(html).toContain('1. Problem');
    expect(html).toContain('4.1 Stack');
    expect(html).toContain('aria-label="Hide contents and threads"');
  });
});
