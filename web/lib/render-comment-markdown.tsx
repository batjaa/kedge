import type { ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import remarkRehype from 'remark-rehype';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { visit } from 'unist-util-visit';
import type { Nodes } from 'hast';
import type { Root } from 'mdast';
import { createRemarkProcessor } from './pipeline';

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function isSafeUrl(value: unknown): boolean {
  const raw = String(value).trim();
  const match = raw.match(SCHEME);
  return !match || SAFE_SCHEMES.has(match[0].toLowerCase());
}

function sanitizeUrls() {
  return (tree: Nodes) => {
    visit(tree, 'element', (node) => {
      const props = node.properties;
      if (!props) return;
      for (const attr of ['href', 'src'] as const) {
        if (props[attr] != null && !isSafeUrl(props[attr])) {
          delete props[attr];
        }
      }
    });
  };
}

function dropRawHtml() {
  return (tree: Root) => {
    stripHtmlChildren(tree);
  };
}

function stripHtmlChildren(node: { children?: Array<{ type?: string; value?: string; children?: unknown[] }> }) {
  if (!Array.isArray(node.children)) return;

  const kept: typeof node.children = [];
  let droppingScript = false;

  for (const child of node.children) {
    if (child.type === 'html') {
      const value = String(child.value ?? '').toLowerCase();
      if (value.includes('<script')) droppingScript = true;
      if (value.includes('</script')) droppingScript = false;
      continue;
    }

    if (droppingScript) continue;
    stripHtmlChildren(child as { children?: Array<{ type?: string; value?: string; children?: unknown[] }> });
    kept.push(child);
  }

  node.children = kept;
}

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
  .use(dropRawHtml)
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
