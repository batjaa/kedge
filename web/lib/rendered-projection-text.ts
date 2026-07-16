import {
  PROJECTION_ATOMIC_ATTR,
  PROJECTION_RANGE_ATTR,
} from './projection';

export interface ProjectionDomAttribute {
  name: string;
  value: string;
}

export interface ProjectionTextRange {
  start: number;
  end: number;
}

export interface ProjectionDomNode {
  nodeName?: string;
  tagName?: string;
  value?: string;
  text?: string;
  attrs?: ProjectionDomAttribute[];
  projectionRange?: ProjectionTextRange | null;
  projectionAtomic?: boolean;
  headingLevel?: number;
  childNodes?: ProjectionDomNode[];
}

export interface ProjectionRenderedChildText {
  child: ProjectionDomNode;
  text: string;
  start: number;
  end: number;
}

export function isProjectionElementNode(node: ProjectionDomNode): boolean {
  return typeof node.tagName === 'string';
}

export function isProjectionTextNode(node: ProjectionDomNode): boolean {
  return node.nodeName === '#text';
}

export function projectionNodeChildren(node: ProjectionDomNode): ProjectionDomNode[] {
  return node.childNodes ?? [];
}

function attr(node: ProjectionDomNode, name: string): string | undefined {
  return node.attrs?.find((entry) => entry.name === name)?.value;
}

export function projectionNodeRange(node: ProjectionDomNode): ProjectionTextRange | null {
  if (node.projectionRange) return node.projectionRange;
  const raw = attr(node, PROJECTION_RANGE_ATTR);
  if (!raw) return null;
  const match = /^(\d+):(\d+)$/.exec(raw);
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]) };
}

export function projectionNodeIsAtomic(node: ProjectionDomNode): boolean {
  return node.projectionAtomic === true || attr(node, PROJECTION_ATOMIC_ATTR) === 'true';
}

export function projectionNodeHeadingLevel(node: ProjectionDomNode): number | null {
  if (typeof node.headingLevel === 'number') return node.headingLevel;
  const tagName = node.tagName?.toLowerCase();
  if (!tagName) return null;
  const match = /^h([1-6])$/.exec(tagName);
  return match ? Number(match[1]) : null;
}

export function projectionNodeTextValue(node: ProjectionDomNode): string {
  return node.value ?? node.text ?? '';
}

export function projectionNodeTagName(node: ProjectionDomNode): string | undefined {
  return node.tagName?.toLowerCase();
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
  if (isProjectionTextNode(node)) return projectionNodeTextValue(node);
  if (!isProjectionElementNode(node)) {
    return projectionNodeChildren(node).map((child) => renderedProjectionText(child, projection)).join('');
  }

  const annotatedRange = projectionNodeRange(node);
  if (projectionNodeIsAtomic(node) && annotatedRange) {
    return projection.slice(annotatedRange.start, annotatedRange.end);
  }
  if (projectionNodeTagName(node) === 'br') return '\n';

  const text = renderedProjectionChildTexts(node, projection)
    .map((part) => part.text)
    .join('');
  return projectionNodeTagName(node) === 'pre' || projectionNodeTagName(node) === 'code'
    ? text.replace(/\n$/, '')
    : text;
}

export function renderedProjectionChildTexts(
  node: ProjectionDomNode,
  projection: string,
): ProjectionRenderedChildText[] {
  const parts: ProjectionRenderedChildText[] = [];
  let previousWasBreak = false;
  let offset = 0;
  for (const child of projectionNodeChildren(node)) {
    let text = renderedProjectionText(child, projection);
    if (previousWasBreak && isProjectionTextNode(child) && text.startsWith('\n')) {
      text = text.slice(1);
    }
    parts.push({ child, text, start: offset, end: offset + text.length });
    offset += text.length;
    previousWasBreak = isProjectionElementNode(child) && projectionNodeTagName(child) === 'br';
  }
  return parts;
}
