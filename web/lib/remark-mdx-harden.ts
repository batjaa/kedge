import { visit, SKIP } from 'unist-util-visit';
import { defaultSchema } from 'rehype-sanitize';
import type { Root } from 'mdast';

// The MDX security model made real (SPEC §6.1). Imported MDX is untrusted CODE —
// this plugin is the gate that decides what compiles at all and what shape the
// surviving tree may take. It runs on the mdast, AFTER remark-diagrams (so
// KrokiDiagram nodes already exist and are allowlisted) and BEFORE @mdx-js/mdx
// turns the tree into JavaScript, so nothing hostile ever reaches the compiled
// module.
//
// Why not rehype-sanitize directly? In MDX every angle-bracket construct — a
// `<Callout>` AND a raw `<script>` — parses to an `mdxJsx*Element` node, never
// to a hast `element`/`raw` node. `hast-util-sanitize` only understands
// element/text/comment/root and silently DROPS every other node type, so
// dropping rehype-sanitize into the pipeline deletes our allowlisted components
// too (verified). We therefore enforce the tight schema here, at the mdxJsx
// level, reusing rehype-sanitize's `defaultSchema` (its curated tag / attribute
// / protocol allowlists) as the schema source of truth — so "raw HTML is
// sanitized against rehype-sanitize's tight schema" holds in substance.
//
// Two outcomes, never a third:
//   - REJECT (throw MdxRejectedError): import/export, non-literal expressions,
//     expression-valued or spread attributes. The caller catches it, the version
//     is marked mdx_ok=false, and the doc renders as plain-markdown fallback —
//     the hostile code never runs.
//   - REWRITE: an unknown component becomes a neutral <UnsupportedComponent>;
//     a disallowed HTML tag / attribute / URL scheme is stripped. The doc still
//     compiles and renders, degraded and safe.

/** Thrown when the document contains a construct that must never compile. */
export class MdxRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MdxRejectedError';
  }
}

/**
 * The JSX component allowlist (SPEC §6.1). Every other capitalized/namespaced
 * name is rewritten to <UnsupportedComponent>. KrokiDiagram is here because
 * remark-diagrams injects it for diagram fences (#21 owns its rendering).
 */
export const ALLOWED_COMPONENTS = new Set([
  'Callout',
  'Note',
  'Warning',
  'CodeGroup',
  'Tabs',
  'KrokiDiagram',
]);

/** The component the harden pass swaps in for a disallowed one. */
export const UNSUPPORTED_COMPONENT = 'UnsupportedComponent';

// Intrinsic (lowercase) HTML JSX = "raw HTML" in MDX. Governed by
// rehype-sanitize's curated allowlists so the schema is principled, not ad hoc.
const ALLOWED_TAGS = new Set<string>(defaultSchema.tagNames ?? []);
const GLOBAL_ATTRS = new Set<string>(stringNames(defaultSchema.attributes?.['*']));
const PROTOCOLS = (defaultSchema.protocols ?? {}) as Record<string, string[]>;

function stringNames(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => (Array.isArray(e) ? String(e[0]) : String(e)));
}

function allowedAttrsFor(tag: string): Set<string> {
  const specific = stringNames(
    (defaultSchema.attributes as Record<string, unknown> | undefined)?.[tag],
  );
  return new Set<string>([...GLOBAL_ATTRS, ...specific]);
}

// A JSX name is a component when it is capitalized or member-access (Foo.Bar);
// lowercase bare names are intrinsic HTML elements (div, span, script, …).
export function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) || name.includes('.');
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A URL attribute value is safe when it has no scheme (relative) or an allowed one. */
function isSafeUrl(value: string, allowedSchemes: string[]): boolean {
  const match = value.trim().match(SCHEME);
  if (!match) return true; // relative / in-page anchor
  const scheme = match[0].slice(0, -1).toLowerCase();
  return allowedSchemes.includes(scheme);
}

interface EstreeCarrier {
  data?: { estree?: { body?: Array<{ type: string; expression?: { type: string } }> } };
  value?: unknown;
}

/**
 * True only for an expression that carries no behavior: an empty `{}` / comment,
 * or a single literal like `{"text"}` / `{42}`. Anything that reads a binding,
 * calls a function, or computes ({x}, {1+1}, {fetch()}) is non-literal → reject.
 */
function isLiteralExpression(node: EstreeCarrier): boolean {
  const estree = node.data?.estree;
  if (estree) {
    const body = estree.body ?? [];
    if (body.length === 0) return true; // {} or comment-only
    return (
      body.length === 1 &&
      body[0].type === 'ExpressionStatement' &&
      body[0].expression?.type === 'Literal'
    );
  }
  // No estree parsed → only a whitespace/empty expression is harmless.
  return typeof node.value === 'string' ? node.value.trim() === '' : node.value == null;
}

export interface MdxJsxAttribute {
  type: string;
  name?: string;
  value?: unknown;
}

export interface MdxJsxElement {
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement';
  name?: string | null;
  attributes?: MdxJsxAttribute[];
  children?: unknown[];
}

export function isMdxJsxElement(node: unknown): node is MdxJsxElement {
  const type = (node as { type?: unknown }).type;
  return type === 'mdxJsxFlowElement' || type === 'mdxJsxTextElement';
}

/**
 * Vet the attributes of a kept element (component or intrinsic). `unist-util-visit`
 * never descends into `attributes`, so an expression smuggled through a prop
 * (`<Callout title={fetch('/x')}>`) would otherwise survive into compiled JS and
 * execute at render. We reject spreads and non-literal expression attributes
 * outright; for intrinsics we additionally drop attributes outside the tight
 * schema and neutralize unsafe URL schemes.
 */
function sanitizeAttributes(node: MdxJsxElement, isComponent: boolean): void {
  const attrs = node.attributes;
  if (!Array.isArray(attrs)) return;

  const allowed = isComponent ? null : allowedAttrsFor(node.name as string);
  const kept: MdxJsxAttribute[] = [];

  for (const attr of attrs) {
    // Spread attribute `{...props}` — never literal, always rejected.
    if (attr.type === 'mdxJsxExpressionAttribute') {
      throw new MdxRejectedError('spread attributes are not allowed in imported MDX');
    }

    const name = attr.name;
    if (typeof name !== 'string') continue;

    // Expression-valued attribute `attr={…}` — allow only literals, reject
    // anything with behavior.
    if (attr.value != null && typeof attr.value === 'object') {
      if (!isLiteralExpression(attr.value as EstreeCarrier)) {
        throw new MdxRejectedError(
          `non-literal expression in attribute "${name}" is not allowed in imported MDX`,
        );
      }
    }

    // Event handlers never survive, on any element.
    if (/^on/i.test(name)) continue;

    if (!isComponent) {
      if (allowed && !allowed.has(name)) continue; // outside the tight schema
      // URL-bearing attribute → scheme allowlist from rehype-sanitize.
      const schemes = PROTOCOLS[name];
      if (schemes && typeof attr.value === 'string' && !isSafeUrl(attr.value, schemes)) {
        continue;
      }
    }

    kept.push(attr);
  }

  node.attributes = kept;
}

function unsupportedNode(name: string, flow: boolean): MdxJsxElement {
  return {
    type: flow ? 'mdxJsxFlowElement' : 'mdxJsxTextElement',
    name: UNSUPPORTED_COMPONENT,
    attributes: [{ type: 'mdxJsxAttribute', name: 'name', value: name }],
    children: [],
  };
}

export function remarkMdxHarden() {
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      const type = node.type as string;

      // 1. import / export — reject outright, never compile.
      if (type === 'mdxjsEsm') {
        throw new MdxRejectedError('import/export statements are not allowed in imported MDX');
      }

      // 2. Expressions — literals and empties pass, everything else is rejected.
      if (type === 'mdxFlowExpression' || type === 'mdxTextExpression') {
        if (!isLiteralExpression(node as unknown as EstreeCarrier)) {
          throw new MdxRejectedError('non-literal expressions are not allowed in imported MDX');
        }
        return;
      }

      // 3. JSX elements — allowlist components, sanitize intrinsic HTML.
      if (isMdxJsxElement(node)) {
        const el = node;
        const name = el.name;

        // A fragment (<>…</>) has no name — harmless wrapper, keep its children.
        if (name == null) return;

        if (isComponentName(name)) {
          if (!ALLOWED_COMPONENTS.has(name)) {
            if (parent && typeof index === 'number') {
              (parent.children as unknown[])[index] = unsupportedNode(
                name,
                type === 'mdxJsxFlowElement',
              );
            }
            return SKIP; // do not descend into the discarded subtree
          }
          sanitizeAttributes(el, true);
          return;
        }

        // Intrinsic HTML. Disallowed tag (script, iframe, style, …) → drop it
        // and everything inside it.
        if (!ALLOWED_TAGS.has(name)) {
          if (parent && typeof index === 'number') {
            (parent.children as unknown[]).splice(index, 1);
            return [SKIP, index];
          }
          return SKIP;
        }
        sanitizeAttributes(el, false);
        return;
      }
    });
  };
}
