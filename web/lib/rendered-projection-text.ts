import {
  PROJECTION_ATOMIC_ATTR,
  PROJECTION_RANGE_ATTR,
} from './projection';

export interface ProjectionDomAttribute {
  name: string;
  value: string;
}

export interface ProjectionDomNode {
  nodeName?: string;
  tagName?: string;
  value?: string;
  attrs?: ProjectionDomAttribute[];
  childNodes?: ProjectionDomNode[];
}

function isElement(node: ProjectionDomNode): boolean {
  return typeof node.tagName === 'string';
}

function isText(node: ProjectionDomNode): boolean {
  return node.nodeName === '#text';
}

function children(node: ProjectionDomNode): ProjectionDomNode[] {
  return node.childNodes ?? [];
}

function attr(node: ProjectionDomNode, name: string): string | undefined {
  return node.attrs?.find((entry) => entry.name === name)?.value;
}

function range(node: ProjectionDomNode): [number, number] | null {
  const raw = attr(node, PROJECTION_RANGE_ATTR);
  if (!raw) return null;
  const match = /^(\d+):(\d+)$/.exec(raw);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

/**
 * Reconstruct the projection text represented by a rendered imported-doc DOM
 * subtree.
 *
 * Wire contract for the capture core:
 * - Nested duplicate ranges are valid: wrappers and their only child may carry
 *   the same `data-prange`, and callers choose the nearest useful ancestor.
 * - Unannotated whitespace/text between annotated leaves remains part of the
 *   reconstructed string; annotations do not replace ordinary DOM text.
 * - Atomic nodes are opaque: `data-patomic="true"` returns the projection slice
 *   for the node's range and does not inspect children.
 */
export function renderedProjectionText(node: ProjectionDomNode, projection: string): string {
  if (isText(node)) return node.value ?? '';
  if (!isElement(node)) {
    return children(node).map((child) => renderedProjectionText(child, projection)).join('');
  }

  const annotatedRange = range(node);
  if (attr(node, PROJECTION_ATOMIC_ATTR) === 'true' && annotatedRange) {
    return projection.slice(annotatedRange[0], annotatedRange[1]);
  }
  if (node.tagName === 'br') return '\n';

  const parts: string[] = [];
  let previousWasBreak = false;
  for (const child of children(node)) {
    let text = renderedProjectionText(child, projection);
    if (previousWasBreak && isText(child) && text.startsWith('\n')) {
      text = text.slice(1);
    }
    parts.push(text);
    previousWasBreak = isElement(child) && child.tagName === 'br';
  }

  const text = parts.join('');
  return node.tagName === 'pre' || node.tagName === 'code' ? text.replace(/\n$/, '') : text;
}
