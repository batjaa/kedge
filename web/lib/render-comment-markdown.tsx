import type { ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import remarkRehype from 'remark-rehype';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Nodes } from 'hast';
import type { Root } from 'mdast';
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
