import type { ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { createHash } from 'node:crypto';
import remarkRehype from 'remark-rehype';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { visit } from 'unist-util-visit';
import type { Nodes } from 'hast';
import type { Root } from 'mdast';
import { createRemarkProcessor } from './pipeline';
import { remarkProjectionAnnotations } from './projection';
import { remarkDiagramsHast } from './remark-diagrams';
import { CachedKrokiDiagram } from '@/components/cached-kroki-diagram';
import { CodeBlock } from '@/components/code-block';
import { withProjectionAttrs } from '@/components/projection-attrs';

// Markdown renderer for imported documents — the safe, markdown-level path used
// for `.md`/`.html` docs and as the plain-markdown fallback when an `.mdx`
// document fails the hardened compile (ticket #17; diagrams added at #21).
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
//   - Diagram fences (the Kroki allowlist) are retargeted to <kroki-diagram> by
//     remarkDiagramsHast and mapped to the API-mediated diagram component, which
//     renders a cached SVG <img> from /storage (readers never contact Kroki).
// Non-diagram fences render as one dark <CodeBlock> panel (no language
// execution) — the same path an unknown fence language takes, so rendering never
// crashes on it. The panel wrapper (issue #48) opts the block out of the prose
// inline-code pill so a multi-line fence reads as one surface, not per-line
// fragments; see components/code-block.tsx.

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const MARKDOWN_RENDER_CACHE_VERSION = 'projection-v2-render-v1';
const MARKDOWN_RENDER_L1_MAX = Number(process.env.MARKDOWN_RENDER_CACHE_MAX ?? 128);
const markdownRenderL1 = new Map<string, Promise<ReactNode>>();

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
  .use(remarkProjectionAnnotations)
  // Retarget diagram fences to <kroki-diagram> before remark-rehype builds hast,
  // so they carry engine + source into the render below (unknown fences untouched).
  .use(remarkDiagramsHast)
  // No allowDangerousHtml: raw HTML nodes are dropped rather than emitted.
  .use(remarkRehype)
  .use(sanitizeUrls);

const MARKDOWN_COMPONENTS = {
  'kroki-diagram': withProjectionAttrs(CachedKrokiDiagram),
  pre: CodeBlock,
};

function markdownCacheKey(markdown: string): string {
  return createHash('sha256')
    .update(MARKDOWN_RENDER_CACHE_VERSION)
    .update('\0')
    .update(markdown)
    .digest('hex');
}

function l1Get(key: string): Promise<ReactNode> | undefined {
  const hit = markdownRenderL1.get(key);
  if (hit) {
    markdownRenderL1.delete(key);
    markdownRenderL1.set(key, hit);
  }
  return hit;
}

function l1Set(key: string, value: Promise<ReactNode>): void {
  markdownRenderL1.set(key, value);
  while (markdownRenderL1.size > MARKDOWN_RENDER_L1_MAX) {
    const oldest = markdownRenderL1.keys().next().value;
    if (oldest === undefined) break;
    markdownRenderL1.delete(oldest);
  }
}

async function renderMarkdownUncached(markdown: string): Promise<ReactNode> {
  const mdast = processor.parse(markdown) as Root;
  const tree = (await processor.run(mdast)) as Nodes;
  return toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    // The non-standard element the pipeline emits (diagram fences) plus the one
    // intrinsic we restyle: a fenced block's <pre> renders as the dark CodeBlock
    // panel (issue #48). Everything else is standard markdown hast rendered by
    // the runtime directly.
    components: MARKDOWN_COMPONENTS,
  });
}

/**
 * Render untrusted markdown to React nodes. Safe against script injection; see
 * the module header for the guarantees.
 */
export async function renderMarkdown(markdown: string): Promise<ReactNode> {
  const key = markdownCacheKey(markdown);
  const cached = l1Get(key);
  if (cached) return cached;
  const pending = renderMarkdownUncached(markdown);
  l1Set(key, pending);
  return pending;
}
