import type { Root, Code } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Kroki is Kedge's sole diagram engine (SPEC §6.2). Fences whose language is
 * a supported Kroki engine become <KrokiDiagram/> elements BEFORE rehype-code
 * (Shiki) runs. Everything else stays a code block — unknown languages fall
 * through to the plain-text Shiki path, never to Kroki.
 *
 * Works for both .mdx and .md content: the JSX nodes are injected
 * programmatically, so no MDX syntax parsing is required.
 */
const KROKI_ENGINES = new Set([
  'blockdiag',
  'bpmn',
  'bytefield',
  'c4plantuml',
  'd2',
  'dbml',
  'ditaa',
  'erd',
  'excalidraw',
  'graphviz',
  'mermaid',
  'nomnoml',
  'nwdiag',
  'pikchr',
  'plantuml',
  'seqdiag',
  'structurizr',
  'svgbob',
  'vega',
  'vegalite',
  'wavedrom',
]);

// Common fence-language aliases → Kroki engine names
const ALIASES: Record<string, string> = {
  dot: 'graphviz',
  c4: 'c4plantuml',
  puml: 'plantuml',
};

/**
 * The single source of truth for "is this fence a diagram?" — resolves a fence
 * language (and its aliases) to a canonical Kroki engine, or null for anything
 * that is not a diagram (prose code, unknown languages → plain text, never
 * Kroki). Shared by the render transform below and the projection walk
 * (lib/projection.ts), so a fence renders as a diagram exactly when it projects
 * to a diagram placeholder — one allowlist, no drift (SPEC §6.2).
 */
export function diagramEngineFor(lang: string | null | undefined): string | null {
  if (!lang) return null;
  const engine = ALIASES[lang] ?? lang;
  return KROKI_ENGINES.has(engine) ? engine : null;
}

/**
 * The MDX-pipeline transform (SPEC §6.2): diagram fences become
 * `<KrokiDiagram/>` JSX BEFORE the harden pass and Shiki run. Used by the
 * hardened MDX compile (lib/mdx) for imported MDX and by the Fumadocs build for
 * the dogfood docs. Non-diagram fences are left untouched → plain-text Shiki.
 */
export function remarkDiagrams() {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code, index, parent) => {
      if (!parent || index === undefined) return;
      const engine = diagramEngineFor(node.lang);
      if (engine === null) return;

      parent.children[index] = {
        type: 'mdxJsxFlowElement',
        name: 'KrokiDiagram',
        attributes: [
          { type: 'mdxJsxAttribute', name: 'engine', value: engine },
          { type: 'mdxJsxAttribute', name: 'source', value: node.value },
        ],
        children: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    });
  };
}

/**
 * The markdown-pipeline transform (SPEC §6.2): the plain / MDX-fallback markdown
 * renderer (lib/render-markdown) has no JSX, so a diagram fence can't become a
 * `<KrokiDiagram/>` node here. Instead we REPLACE the `code` node with a node
 * that remark-rehype emits as a bare `<kroki-diagram engine source>` element,
 * which the renderer maps to the diagram component.
 *
 * We replace rather than retarget the code node's `data.hName`, because a `code`
 * node renders as `<pre><code>` and the override lands on the inner `<code>`,
 * leaving a stray `<pre>` wrapper. A fresh node carrying only `hName`/
 * `hProperties`/`hChildren` produces a single clean element. The source is the
 * fence's exact `node.value` — identical to what the MDX transform passes — so a
 * diagram re-used across `.md` and `.mdx` hashes the same and shares one cache
 * entry (SPEC §6.2).
 *
 * Same allowlist (`diagramEngineFor`) as the MDX transform and the projection, so
 * a fence renders as a diagram exactly when it projects to a diagram token — one
 * definition, no drift. Unknown fences are left as ordinary code → plain text.
 */
export function remarkDiagramsHast() {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code, index, parent) => {
      if (!parent || index === undefined) return;
      const engine = diagramEngineFor(node.lang);
      if (engine === null) return;

      parent.children[index] = {
        type: 'paragraph',
        children: [],
        data: {
          hName: 'kroki-diagram',
          hProperties: { ...(node.data?.hProperties ?? {}), engine, source: node.value },
          hChildren: [],
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    });
  };
}
