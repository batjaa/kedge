import type { Root, Code } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Converts ```mermaid and ```plantuml fences into <Mermaid/> / <PlantUML/>
 * MDX elements BEFORE rehype-code (Shiki) runs — fences become live diagrams,
 * matching SPEC §6.2. Works for both .mdx and .md content: the JSX nodes are
 * injected programmatically, so no MDX syntax parsing is required.
 */
export function remarkDiagrams() {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code, index, parent) => {
      if (!parent || index === undefined) return;
      const name =
        node.lang === 'mermaid' ? 'Mermaid' : node.lang === 'plantuml' ? 'PlantUML' : null;
      if (!name) return;

      parent.children[index] = {
        type: 'mdxJsxFlowElement',
        name,
        attributes: [
          {
            type: 'mdxJsxAttribute',
            name: name === 'Mermaid' ? 'chart' : 'source',
            value: node.value,
          },
        ],
        children: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    });
  };
}
