import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { projectMdx, renderMdx } from '../lib/mdx';

// Fixture-level demo of the `.mdx` render path (SPEC §6.1). A realistic imported
// MDX document — the kind an author pastes a raw URL to — flows end to end
// through the hardened pipeline. This is the unit-test twin of the live
// verification: allowlisted components render, an unknown one degrades, raw HTML
// is sanitized, an unknown fence stays plain text — all in one document.
const SHOWCASE = readFileSync(join(import.meta.dirname, 'fixtures', 'mdx', 'showcase.mdx'), 'utf8');

describe('imported .mdx showcase renders through the hardened path', () => {
  it('compiles cleanly (mdx_ok = true)', async () => {
    expect((await projectMdx(SHOWCASE)).mdxOk).toBe(true);
  });

  it('renders the whole document safely', async () => {
    const { node, ok } = await renderMdx(SHOWCASE);
    const markup = renderToStaticMarkup(node);

    expect(ok).toBe(true);

    // Allowlisted components render as Kedge components.
    expect(markup).toContain('Anchoring note');
    expect(markup).toContain('<strong>cosmetic</strong>');

    // Unknown component → neutral box; its inner content is discarded.
    expect(markup).toContain('Unsupported component');
    expect(markup).toContain('ExperimentalWidget');
    expect(markup).not.toContain('Anything inside an unknown component');

    // Raw HTML sanitized: <kbd> kept, <script> and its payload gone.
    expect(markup).toContain('<kbd>Esc</kbd>');
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain("alert('xss')");

    // Unknown fence language survives as plain text.
    expect(markup).toContain('(module (func $noop))');
  });
});

describe('diagram fences and unknown languages never crash the MDX compile', () => {
  it('compiles a Kroki diagram fence (→ allowlisted KrokiDiagram)', async () => {
    expect((await projectMdx('```mermaid\ngraph TD\nA-->B\n```')).mdxOk).toBe(true);
  });

  it('compiles an unknown fence language (→ plain code)', async () => {
    const { node, ok } = await renderMdx('```qwerty\nnot a real language\n```');
    expect(ok).toBe(true);
    expect(renderToStaticMarkup(node)).toContain('not a real language');
  });
});
