import type { Nodes, PhrasingContent } from 'mdast';
import { parseToMdast } from './pipeline';
import { diagramEngineFor } from './remark-diagrams';

// Text projection — the anchor substrate (SPEC §5.4). Walks the SAME mdast the
// renderer derives its page from (lib/pipeline.ts) down to the plain text a
// comment anchor's { start, end } offsets point into. Web owns this because web
// owns rendering: one AST, so "what the reader sees" and "what a comment binds
// to" can never silently drift and misplace a thread.
//
// ── projection_version ──────────────────────────────────────────────────────
// Stored on every version (and, at M2, every anchor). Bump it whenever a change
// to this algorithm alters the output for any existing golden fixture — the same
// commit must regenerate the corpus intentionally (npm run test:projection --
// --update-golden; see lib/__tests__/projection.golden.test.ts). A silent change
// would reinterpret every stored offset and move real comments; the version +
// the failing corpus are the guardrail that makes such a change deliberate.
export const PROJECTION_VERSION = 1;

// ── Placeholder tokens ───────────────────────────────────────────────────────
// Non-text blocks (images, diagram fences, and — forward-compat — MDX/JSX
// components) collapse to a single stable token so that:
//   • text offsets around them stay stable (the block occupies one fixed span);
//   • a selection cannot land *inside* a non-text block — M2's selection logic
//     treats the whole ⟦…⟧ run as one atomic, unspannable boundary;
//   • re-projecting identical content yields byte-identical output (no counters,
//     no hashes in the token → dedupe-safe, corpus-diffable).
// The delimiters are U+27E6/U+27E7 (mathematical white square brackets): they
// effectively never occur in prose, and any literal occurrence in source text is
// stripped (see `clean`) so a token is always unambiguous.
export const PLACEHOLDER_OPEN = '⟦'; // ⟦
export const PLACEHOLDER_CLOSE = '⟧'; // ⟧

const DELIMITERS = /[⟦⟧]/g;

function token(kind: string): string {
  return `${PLACEHOLDER_OPEN}${kind}${PLACEHOLDER_CLOSE}`;
}

/** `⟦image⟧` — a markdown image or image reference. */
export const imageToken = (): string => token('image');
/** `⟦diagram:<engine>⟧` — a fence whose language is a Kroki engine (§6.2). */
export const diagramToken = (engine: string): string => token(`diagram:${engine}`);
/** `⟦component:<Name>⟧` — an MDX/JSX component (arrives with the #20 MDX parser). */
export const componentToken = (name: string): string => token(`component:${name}`);

export interface ProjectionResult {
  /** The anchor substrate: document body as plain text with placeholder tokens. */
  plainText: string;
  /** Algorithm version stored alongside `plainText`; see PROJECTION_VERSION. */
  projectionVersion: number;
  /**
   * Whether the content is valid as MDX. M1 projects markdown, which always
   * parses, so this is `true`; #20's hardened MDX compile turns it into a real
   * gate (a `false` marks the version for plain-markdown fallback, SPEC §5.2).
   */
  mdxOk: boolean;
  /** Projection-level observations (e.g. reserved delimiters stripped). */
  warnings: string[];
}

interface Ctx {
  stripped: number;
}

/** Remove reserved token delimiters from literal text so tokens stay unambiguous. */
function clean(value: string, ctx: Ctx): string {
  let stripped = 0;
  const out = value.replace(DELIMITERS, () => {
    stripped++;
    return '';
  });
  ctx.stripped += stripped;
  return out;
}

/** Concatenate the text of a run of inline (phrasing) nodes. */
function inline(nodes: PhrasingContent[] | undefined, ctx: Ctx): string {
  if (!nodes) return '';
  let out = '';
  for (const node of nodes) out += inlineNode(node, ctx);
  return out;
}

function inlineNode(node: PhrasingContent, ctx: Ctx): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return clean(node.value, ctx);
    case 'break':
      return '\n';
    case 'image':
    case 'imageReference':
      return imageToken();
    case 'emphasis':
    case 'strong':
    case 'delete':
    case 'link':
    case 'linkReference':
      return inline(node.children, ctx);
    // Raw inline HTML is dropped (render runs without allowDangerousHtml, so it
    // never reaches the page either); footnote refs carry no reading-flow text.
    case 'html':
    case 'footnoteReference':
      return '';
    default:
      return '';
  }
}

/** Project one block-level node to text, or '' for structural/metadata blocks. */
function block(node: Nodes, ctx: Ctx): string {
  // Forward-compat: an MDX/JSX element (once #20 swaps in the MDX parser) is a
  // non-text block → one component placeholder, whatever its children.
  const kind = node.type as string;
  if (kind === 'mdxJsxFlowElement' || kind === 'mdxJsxTextElement') {
    const name = (node as { name?: string | null }).name ?? 'unknown';
    return componentToken(name);
  }

  switch (node.type) {
    case 'heading':
    case 'paragraph':
      return inline(node.children, ctx);
    case 'blockquote':
      return blocks(node.children, '\n\n', ctx);
    case 'list':
      return node.children.map((item) => block(item, ctx)).filter(Boolean).join('\n');
    case 'listItem':
      return blocks(node.children, '\n', ctx);
    case 'code': {
      const engine = diagramEngineFor(node.lang);
      // Prose code stays anchorable text; a diagram fence collapses to a token.
      return engine ? diagramToken(engine) : clean(node.value, ctx);
    }
    case 'table':
      return node.children
        .map((row) => row.children.map((cell) => inline(cell.children, ctx)).join(' '))
        .join('\n');
    case 'image':
      return imageToken();
    // Structural or metadata blocks carry no anchor text: a raw-HTML block is
    // dropped (matches render), a rule/frontmatter/link-definition never renders.
    case 'html':
    case 'thematicBreak':
    case 'yaml':
    case 'definition':
    case 'footnoteDefinition':
      return '';
    default:
      return 'children' in node ? blocks(node.children as Nodes[], '\n\n', ctx) : '';
  }
}

/** Project a run of block nodes, dropping empties, joined by `sep`. */
function blocks(nodes: Nodes[], sep: string, ctx: Ctx): string {
  const parts: string[] = [];
  for (const node of nodes) {
    const text = block(node, ctx);
    if (text !== '') parts.push(text);
  }
  return parts.join(sep);
}

/**
 * Project normalized markdown/MDX source to its plain-text anchor substrate.
 * Deterministic and total: given the same source it returns byte-identical
 * output, and it never throws on well-formed markdown.
 */
export function project(source: string): ProjectionResult {
  const tree = parseToMdast(source);
  const ctx: Ctx = { stripped: 0 };
  const plainText = blocks(tree.children, '\n\n', ctx);

  const warnings: string[] = [];
  if (ctx.stripped > 0) {
    warnings.push(
      `Stripped ${ctx.stripped} reserved placeholder delimiter character(s) from source text.`,
    );
  }

  return {
    plainText,
    projectionVersion: PROJECTION_VERSION,
    mdxOk: true,
    warnings,
  };
}
