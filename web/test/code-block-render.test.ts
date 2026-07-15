import type { ReactElement } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMarkdown } from '../lib/render-markdown';
import { renderMdx } from '../lib/mdx';

// Regression guard for issue #48 — multi-line fenced code blocks in IMPORTED
// documents must render as ONE contiguous code panel, not a stack of per-line
// fragments. The bug was purely CSS: a bare <pre><code> inside <article
// class="prose"> inherited Fumadocs' inline-code pill on the <code>, which — on
// a `display:inline` element spanning the <pre>'s preserved newlines — repaints
// once per wrapped line. The fix routes every fenced <pre> through the dark
// CodeBlock panel (components/code-block.tsx), whose `not-prose` opts the block
// out of that pill. These assert the rendered structure so the regression can't
// return silently: one <pre> per fence, newlines preserved, the not-prose escape
// present — across BOTH the markdown and the MDX pipelines.

const MULTILINE = ['const a = 1;', 'function f() {', '  return a + 2;', '}'].join('\n');
const WITH_LANG = '```ts\n' + MULTILINE + '\n```';
const NO_LANG = '```\n' + MULTILINE + '\n```';

function count(haystack: string, needle: RegExp): number {
  return (haystack.match(needle) ?? []).length;
}

// The two imported-doc render paths, exercised through the same assertions so md
// and mdx are proven to agree on code-block structure.
const PATHS: Array<[name: string, render: (src: string) => Promise<string>]> = [
  [
    'markdown (.md / fallback)',
    async (src) => renderToStaticMarkup((await renderMarkdown(src)) as ReactElement),
  ],
  [
    'mdx',
    async (src) => {
      const { node, ok } = await renderMdx(src);
      expect(ok).toBe(true); // a plain fence must never fail the hardened compile
      return renderToStaticMarkup(node);
    },
  ],
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(PATHS)('fenced code blocks — %s path', (_name, render) => {
  it('renders a multi-line fence WITH a language as a single contiguous block', async () => {
    const html = await render(WITH_LANG);

    // Exactly one <pre> and one <code> — one block, not one per line.
    expect(count(html, /<pre/g)).toBe(1);
    expect(count(html, /<code/g)).toBe(1);

    // Newlines preserved verbatim inside the one code element.
    expect(html).toContain('const a = 1;\nfunction f() {\n  return a + 2;\n}');

    // The <pre> carries the not-prose escape — the actual mechanism that stops
    // Fumadocs' inline-code pill from fragmenting the block (issue #48 root cause).
    expect(html).toMatch(/<pre[^>]*\bnot-prose\b/);

    // The language survives on the inner <code> for future syntax hinting.
    expect(html).toContain('language-ts');
  });

  it('renders a multi-line fence WITHOUT a language as a single contiguous block', async () => {
    const html = await render(NO_LANG);

    expect(count(html, /<pre/g)).toBe(1);
    expect(count(html, /<code/g)).toBe(1);
    expect(html).toContain('const a = 1;\nfunction f() {\n  return a + 2;\n}');
    expect(html).toMatch(/<pre[^>]*\bnot-prose\b/);
  });

  it('renders an unknown fence language as plain text — never crashes, never Kroki', async () => {
    const html = await render('```qwerty\nnot a real language\nsecond line\n```');

    expect(count(html, /<pre/g)).toBe(1);
    expect(html).toContain('not a real language\nsecond line');
  });

  it('leaves two adjacent fences as two separate panels', async () => {
    const html = await render('```\nalpha\nbeta\n```\n\n```\ngamma\ndelta\n```');

    expect(count(html, /<pre/g)).toBe(2);
    expect(html).toContain('alpha\nbeta');
    expect(html).toContain('gamma\ndelta');
  });
});

describe('inline code is untouched by the block-code panel', () => {
  it('keeps single-backtick code as bare <code> — no <pre>, no not-prose wrapper (markdown)', async () => {
    const html = renderToStaticMarkup(
      (await renderMarkdown('A paragraph with `inline` code in it.')) as ReactElement,
    );

    expect(html).toContain('<code>inline</code>');
    expect(html).not.toContain('<pre');
    expect(html).not.toContain('not-prose');
  });
});

describe('diagram fences never render as the code panel', () => {
  it('routes a diagram fence to KrokiDiagram, not the <pre> CodeBlock (markdown)', async () => {
    // Fake the diagram API so nothing hits the network; a pending diagram renders
    // its Suspense skeleton, which prints the engine name.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: '/storage/diagrams/mermaid/x.svg' }), { status: 200 }),
    );

    const html = renderToStaticMarkup((await renderMarkdown('```mermaid\ngraph TD\nA-->B\n```')) as ReactElement);

    expect(html).not.toContain('<pre'); // diagram, not a code panel
    expect(html).toContain('rendering mermaid');
  });
});
