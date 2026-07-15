import type { ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import remarkRehype from 'remark-rehype';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { visit } from 'unist-util-visit';
import type { Nodes } from 'hast';
import { createRemarkProcessor } from './pipeline';

// INTERIM markdown renderer for imported documents (ticket #17 tracer bullet).
//
// This is deliberately the *simple, safe* path — markdown-level rendering only.
// The hardened MDX pipeline (import/export rejection, component allowlist) is
// ticket #20 and Kroki diagrams are #21; this spine renders standard markdown
// and gets replaced/widened there. It runs server-side only.
//
// Safety posture (imported documents are untrusted — AGENTS.md hard rule #2):
//   - remark-rehype runs WITHOUT `allowDangerousHtml`, so any raw HTML in the
//     source (a <script>, an <img onerror=…>) is dropped, never parsed into
//     live DOM. There is no raw-HTML passthrough anywhere in this pipeline.
//   - The only attributes reaching output are the ones mdast-util-to-hast emits
//     for standard markdown (href, src, alt, …) — no event handlers, no style.
//   - `sanitizeUrls` strips href/src whose scheme is not http(s)/mailto/tel, so
//     a `[x](javascript:…)` link cannot execute script.
//   - Output is real React elements via the jsx runtime — no
//     dangerouslySetInnerHTML.
// Fenced code renders as plain <pre><code> (no language execution), which also
// satisfies the never-crash-on-unknown-fence rule.

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function isSafeUrl(value: unknown): boolean {
  const raw = String(value).trim();
  const match = raw.match(SCHEME);
  // No scheme → relative or in-page anchor, always safe. Otherwise allowlist.
  return !match || SAFE_SCHEMES.has(match[0].toLowerCase());
}

function sanitizeUrls() {
  return (tree: Nodes) => {
    visit(tree, 'element', (node) => {
      const props = node.properties;
      if (!props) return;
      for (const attr of ['href', 'src'] as const) {
        if (props[attr] != null && !isSafeUrl(props[attr])) {
          delete props[attr];
        }
      }
    });
  };
}

// Extends the shared remark parser (lib/pipeline.ts) — the same mdast the
// projection walks (SPEC §5.4) — with the render-only hast half. Rendering and
// projection therefore agree, by construction, on where every block begins.
const processor = createRemarkProcessor()
  // No allowDangerousHtml: raw HTML nodes are dropped rather than emitted.
  .use(remarkRehype)
  .use(sanitizeUrls);

/**
 * Render untrusted markdown to React nodes. Safe against script injection; see
 * the module header for the guarantees.
 */
export async function renderMarkdown(markdown: string): Promise<ReactNode> {
  const tree = (await processor.run(processor.parse(markdown))) as Nodes;
  return toJsxRuntime(tree, { Fragment, jsx, jsxs });
}
