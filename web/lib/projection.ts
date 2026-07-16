import type { Nodes, PhrasingContent, Root } from 'mdast';
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
  /** Render-time ranges that mirror `plainText` offsets. */
  annotations: ProjectionAnnotation[];
}

export interface ProjectionAnnotation {
  start: number;
  end: number;
  atomic: boolean;
  token?: string;
}

interface Ctx {
  stripped: number;
  annotate: boolean;
  annotations: ProjectionAnnotation[];
}

interface Piece {
  text: string;
  apply(base: number, ctx: Ctx): void;
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

export const PROJECTION_RANGE_ATTR = 'data-prange';
export const PROJECTION_ATOMIC_ATTR = 'data-patomic';

// Capture reads `data-prange="start:end"` from rendered imported-doc elements.
// `data-patomic="true"` marks placeholder-token spans (image/diagram/component)
// as unspannable: the token occupies the annotated range, but selections must
// not descend into the rendered node.
export function projectionDataAttributes(annotation: ProjectionAnnotation): Record<string, string> {
  const attrs: Record<string, string> = {
    [PROJECTION_RANGE_ATTR]: `${annotation.start}:${annotation.end}`,
  };
  if (annotation.atomic) attrs[PROJECTION_ATOMIC_ATTR] = 'true';
  return attrs;
}

function literal(text: string): Piece {
  return { text, apply: () => {} };
}

function marked(
  node: Nodes | PhrasingContent,
  piece: Piece,
  opts: { atomic?: boolean; token?: string } = {},
): Piece {
  return {
    text: piece.text,
    apply(base, ctx) {
      if (piece.text === '') return;
      const annotation: ProjectionAnnotation = {
        start: base,
        end: base + piece.text.length,
        atomic: opts.atomic === true,
        token: opts.token,
      };
      ctx.annotations.push(annotation);
      if (ctx.annotate) annotateNode(node, annotation);
      piece.apply(base, ctx);
    },
  };
}

function concat(parts: Piece[], sep: string): Piece {
  const nonEmpty = parts.filter((part) => part.text !== '');
  return {
    text: nonEmpty.map((part) => part.text).join(sep),
    apply(base, ctx) {
      let offset = base;
      for (const [index, part] of nonEmpty.entries()) {
        if (index > 0) offset += sep.length;
        part.apply(offset, ctx);
        offset += part.text.length;
      }
    },
  };
}

function annotateNode(node: Nodes | PhrasingContent, annotation: ProjectionAnnotation): void {
  const attrs = projectionDataAttributes(annotation);
  const dataNode = node as { data?: { hProperties?: Record<string, unknown> } };
  dataNode.data ??= {};
  dataNode.data.hProperties = { ...(dataNode.data.hProperties ?? {}), ...attrs };

  if (!isMdxJsxElement(node)) return;
  const jsxNode = node as MdxJsxElement;
  const existing = Array.isArray(jsxNode.attributes) ? jsxNode.attributes : [];
  const names = new Set(Object.keys(attrs));
  jsxNode.attributes = [
    ...existing.filter((attr) => {
      return !(attr.type === 'mdxJsxAttribute' && typeof attr.name === 'string' && names.has(attr.name));
    }),
    ...Object.entries(attrs).map(([name, value]) => ({
      type: 'mdxJsxAttribute' as const,
      name,
      value,
    })),
  ];
}

interface MdxJsxAttribute {
  type: 'mdxJsxAttribute';
  name?: string;
  value?: unknown;
}

interface MdxJsxElement {
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement';
  name?: string | null;
  attributes?: MdxJsxAttribute[];
  children?: unknown[];
}

function isMdxJsxElement(node: unknown): node is MdxJsxElement {
  const type = (node as { type?: unknown }).type;
  return type === 'mdxJsxFlowElement' || type === 'mdxJsxTextElement';
}

function jsxAttr(node: MdxJsxElement, name: string): unknown {
  return node.attributes?.find((attr) => attr.type === 'mdxJsxAttribute' && attr.name === name)?.value;
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) || name.includes('.');
}

function mdxChildren(node: MdxJsxElement, ctx: Ctx): Piece {
  return node.type === 'mdxJsxTextElement'
    ? inline((node.children ?? []) as PhrasingContent[], ctx)
    : blocks((node.children ?? []) as Nodes[], '\n\n', ctx);
}

function mdxJsx(node: MdxJsxElement, ctx: Ctx): Piece {
  const name = node.name;
  if (name == null) return mdxChildren(node, ctx);

  if (name === 'KrokiDiagram') {
    const engine = String(jsxAttr(node, 'engine') ?? 'unknown');
    const text = diagramToken(engine);
    return marked(node as unknown as Nodes, literal(text), { atomic: true, token: text });
  }

  if (name === 'UnsupportedComponent') {
    const original = String(jsxAttr(node, 'name') ?? 'unknown');
    const text = componentToken(original);
    return marked(node as unknown as Nodes, literal(text), { atomic: true, token: text });
  }

  if (isComponentName(name)) {
    const text = componentToken(name);
    return marked(node as unknown as Nodes, literal(text), { atomic: true, token: text });
  }

  if (name === 'img') {
    const text = imageToken();
    return marked(node as unknown as Nodes, literal(text), { atomic: true, token: text });
  }

  return mdxChildren(node, ctx);
}

function mdxLiteralExpression(node: { data?: { estree?: unknown }; value?: unknown }, ctx: Ctx): Piece {
  const body = (node.data?.estree as { body?: Array<{ expression?: { value?: unknown } }> } | undefined)?.body;
  if (body?.length === 1 && 'value' in (body[0].expression ?? {})) {
    const value = body[0].expression?.value;
    return literal(value == null || typeof value === 'boolean' ? '' : clean(String(value), ctx));
  }
  return literal('');
}

/** Concatenate the text of a run of inline (phrasing) nodes. */
function inline(nodes: PhrasingContent[] | undefined, ctx: Ctx): Piece {
  if (!nodes) return literal('');
  return concat(nodes.map((node) => inlineNode(node, ctx)), '');
}

function inlineNode(node: PhrasingContent, ctx: Ctx): Piece {
  if (isMdxJsxElement(node)) return mdxJsx(node, ctx);

  const kind = node.type as string;
  if (kind === 'mdxTextExpression') {
    return mdxLiteralExpression(node as unknown as { data?: { estree?: unknown }; value?: unknown }, ctx);
  }

  switch (node.type) {
    case 'text':
      return literal(clean(node.value, ctx));
    case 'inlineCode':
      return marked(node, literal(clean(node.value, ctx)));
    case 'break':
      return literal('\n');
    case 'image':
    case 'imageReference': {
      const text = imageToken();
      return marked(node, literal(text), { atomic: true, token: text });
    }
    case 'emphasis':
    case 'strong':
    case 'delete':
    case 'link':
    case 'linkReference':
      return marked(node, inline(node.children, ctx));
    // Raw inline HTML is dropped (render runs without allowDangerousHtml, so it
    // never reaches the page either); footnote refs carry no reading-flow text.
    case 'html':
    case 'footnoteReference':
      return literal('');
    default:
      return literal('');
  }
}

/** Project one block-level node to text, or '' for structural/metadata blocks. */
function block(node: Nodes, ctx: Ctx): Piece {
  // Forward-compat: an MDX/JSX element (once #20 swaps in the MDX parser) is a
  // non-text block → one component placeholder, whatever its children.
  if (isMdxJsxElement(node)) return mdxJsx(node, ctx);

  const kind = node.type as string;
  if (kind === 'mdxFlowExpression') {
    return mdxLiteralExpression(node as unknown as { data?: { estree?: unknown }; value?: unknown }, ctx);
  }

  switch (node.type) {
    case 'heading':
    case 'paragraph':
      return marked(node, inline(node.children, ctx));
    case 'blockquote':
      return blocks(node.children, '\n\n', ctx);
    case 'list':
      return concat(node.children.map((item) => block(item, ctx)), '\n');
    case 'listItem':
      return blocks(node.children, '\n', ctx);
    case 'code': {
      const engine = diagramEngineFor(node.lang);
      // Prose code stays anchorable text; a diagram fence collapses to a token.
      const text = engine ? diagramToken(engine) : clean(node.value, ctx);
      return marked(node, literal(text), {
        atomic: engine !== null,
        token: engine ? text : undefined,
      });
    }
    case 'table':
      return concat(
        node.children.map((row) => concat(row.children.map((cell) => marked(cell, inline(cell.children, ctx))), ' ')),
        '\n',
      );
    case 'image': {
      const text = imageToken();
      return marked(node, literal(text), { atomic: true, token: text });
    }
    // Structural or metadata blocks carry no anchor text: a raw-HTML block is
    // dropped (matches render), a rule/frontmatter/link-definition never renders.
    case 'html':
    case 'thematicBreak':
    case 'yaml':
    case 'definition':
    case 'footnoteDefinition':
      return literal('');
    default:
      return 'children' in node ? blocks(node.children as Nodes[], '\n\n', ctx) : literal('');
  }
}

/** Project a run of block nodes, dropping empties, joined by `sep`. */
function blocks(nodes: Nodes[], sep: string, ctx: Ctx): Piece {
  return concat(nodes.map((node) => block(node, ctx)), sep);
}

/**
 * Project an already-parsed mdast tree to its plain-text anchor substrate.
 * With `annotate: true`, the same walk also emits render-time data attributes
 * onto the mdast nodes that become DOM elements.
 */
export function projectMdast(tree: Root, options: { annotate?: boolean } = {}): ProjectionResult {
  const ctx: Ctx = { stripped: 0, annotate: options.annotate === true, annotations: [] };
  const piece = blocks(tree.children, '\n\n', ctx);
  piece.apply(0, ctx);
  const plainText = piece.text;

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
    annotations: ctx.annotations,
  };
}

/**
 * Project normalized markdown/MDX source to its plain-text anchor substrate.
 * Deterministic and total: given the same source it returns byte-identical
 * output, and it never throws on well-formed markdown.
 */
export function project(source: string): ProjectionResult {
  const tree = parseToMdast(source);
  return projectMdast(tree);
}

export const PROJECTION_FILE_DATA_KEY = 'kedgeProjection';

export function remarkProjectionAnnotations(options: { annotate?: boolean } = {}) {
  return (tree: Root, file: { data: Record<string, unknown> }) => {
    file.data[PROJECTION_FILE_DATA_KEY] = projectMdast(tree, {
      annotate: options.annotate === true,
    });
  };
}
