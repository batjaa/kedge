import type { ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import remarkRehype from 'remark-rehype';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Nodes } from 'hast';
import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';
import { createRemarkProcessor } from './pipeline';
import { sanitizeUrls } from './sanitize-urls';

function CommentPre({ children }: { children?: ReactNode }) {
  return (
    <pre className="not-prose my-3 overflow-x-auto rounded-lg bg-zinc-900 p-3 font-mono text-xs leading-relaxed text-zinc-300 ring-1 ring-inset ring-white/10">
      {children}
    </pre>
  );
}

const processor = createRemarkProcessor()
  // No diagram transform, no MDX components, and no dangerous HTML. Fences stay
  // ordinary code blocks; raw HTML nodes are dropped by remark-rehype.
  .use(remarkRehype)
  .use(renderMentionLinks)
  .use(sanitizeUrls);

export function renderCommentMarkdown(markdown: string): ReactNode {
  const mdast = processor.parse(markdown) as Root;
  const tree = processor.runSync(mdast) as Nodes;
  return toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    components: { pre: CommentPre },
  });
}

function renderMentionLinks() {
  return (tree: Nodes) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'a') return;

      const href = node.properties?.href;
      if (typeof href !== 'string') return;

      const match = href.match(/^mention:(\d+)$/);
      if (!match) return;

      const label = textContent(node).trim();
      node.tagName = 'span';
      node.properties = {
        className: [
          'inline-flex',
          'items-center',
          'rounded-lg',
          'bg-emerald-500/10',
          'px-1.5',
          'py-0.5',
          'font-mono',
          'text-[11px]',
          'font-semibold',
          'text-emerald-700',
          'ring-1',
          'ring-inset',
          'ring-emerald-400/30',
          'dark:text-emerald-300',
        ],
        dataMentionId: match[1],
      };
      node.children = [{ type: 'text', value: label.startsWith('@') ? label : `@${label || 'mention'}` }];
    });
  };
}

function textContent(node: Nodes): string {
  if (node.type === 'text') return node.value;
  if ('children' in node && Array.isArray(node.children)) {
    return node.children.map((child) => textContent(child as Nodes)).join('');
  }

  return '';
}
