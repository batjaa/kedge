import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import type { Root } from 'mdast';

// The one definition of "what a document is" (SPEC §5.4). Both surfaces that a
// reviewer's world is built on start here:
//
//   - Rendering (lib/render-markdown.tsx) extends this processor with
//     remark-rehype and projects the SAME mdast to the React tree readers see.
//   - Projection (lib/projection.ts) walks the SAME mdast to the plain-text
//     anchor substrate comments bind to.
//
// One parser means rendering and anchoring can never disagree about where a
// heading, a paragraph, an image, or a code fence begins — the silent drift
// that would misplace every comment (the reason web owns projection, §5.4).
//
// Frontmatter is parsed into a `yaml` node (not stray `---`/text): rendering
// drops it (remark-rehype has no yaml handler) and projection skips it, so a
// document's metadata never leaks into either the page or the anchor text.

/**
 * A fresh remark processor with Kedge's shared markdown dialect (GFM tables /
 * strikethrough / autolinks + YAML frontmatter). Returns a new, unfrozen
 * instance each call so callers may `.use()` further plugins (render adds
 * remark-rehype); never share one instance across the two surfaces.
 */
export function createRemarkProcessor() {
  return unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter);
}

/**
 * Parse markdown/MDX-flavoured source to the shared mdast tree — the exact tree
 * rendering derives its hast from. Synchronous: the shared remark plugins carry
 * no async transformers, which keeps the projection (and its golden corpus)
 * deterministic and free of a render round-trip.
 */
export function parseToMdast(source: string): Root {
  const processor = createRemarkProcessor();
  return processor.runSync(processor.parse(source)) as Root;
}
