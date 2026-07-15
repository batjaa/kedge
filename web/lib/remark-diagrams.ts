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
