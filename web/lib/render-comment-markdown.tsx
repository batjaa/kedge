import type { ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import remarkRehype from 'remark-rehype';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Nodes } from 'hast';
import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';
import { createRemarkProcessor } from './pipeline';
import { sanitizeUrls } from './sanitize-urls';
import type { MentionCandidate } from './thread-types';

function CommentPre({ children }: { children?: ReactNode }) {
  return (
    <pre className="not-prose my-3 overflow-x-auto rounded-lg bg-zinc-900 p-3 font-mono text-xs leading-relaxed text-zinc-300 ring-1 ring-inset ring-white/10">
      {children}
    </pre>
  );
}

export function renderCommentMarkdown(markdown: string, mentions: readonly MentionCandidate[] = []): ReactNode {
  const processor = createRemarkProcessor()
    // No diagram transform, no MDX components, and no dangerous HTML. Fences stay
    // ordinary code blocks; raw HTML nodes are dropped by remark-rehype.
    .use(remarkRehype)
    .use(renderMentionLinks, mentions)
    .use(sanitizeUrls);
  const mdast = processor.parse(markdown) as Root;
  const tree = processor.runSync(mdast) as Nodes;
  return toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    components: { pre: CommentPre },
  });
}

function renderMentionLinks(mentions: readonly MentionCandidate[] = []) {
  const canonicalNames = new Map(mentions.map((mention) => [String(mention.id), mention.name]));

  return (tree: Nodes) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'a') return;

      const href = node.properties?.href;
      if (typeof href !== 'string') return;

      // Persisted mention token format: [@Label](mention:id). Keep in sync with
      // web/lib/mention-tokens.ts and api/app/Services/Comments/CommentMentionService.php.
      const match = href.match(/^mention:(\d+)$/);
      if (!match) return;

      const mentionId = match[1];
      const label = canonicalNames.get(mentionId);
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
        dataMentionId: mentionId,
      };
      node.children = [{ type: 'text', value: label ? `@${label}` : '@mention' }];
    });
  };
}
