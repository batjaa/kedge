import type { Nodes } from 'hast';
import { visit } from 'unist-util-visit';

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function isSafeUrl(value: unknown): boolean {
  const raw = String(value).trim();
  const match = raw.match(SCHEME);
  return !match || SAFE_SCHEMES.has(match[0].toLowerCase());
}

export function sanitizeUrls() {
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
