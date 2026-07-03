import type { Root, Code } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Kroki is Margin's sole diagram engine (SPEC §6.2). Fences whose language is
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

export function remarkDiagrams() {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code, index, parent) => {
      if (!parent || index === undefined || !node.lang) return;
      const engine = ALIASES[node.lang] ?? node.lang;
      if (!KROKI_ENGINES.has(engine)) return;

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
