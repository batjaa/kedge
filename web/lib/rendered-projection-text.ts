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
  attrs?: ProjectionDomAttribute[];
  childNodes?: ProjectionDomNode[];
}

export interface ProjectionNodeAnnotation {
  range: ProjectionTextRange | null;
  atomic: boolean;
  malformed: boolean;
  detail: string | null;
}

export interface ProjectionRenderedChildText {
  child: ProjectionDomNode;
  text: string;
  start: number;
  end: number;
}

function isProjectionElementNode(node: ProjectionDomNode): boolean {
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

export function projectionNodeAnnotation(node: ProjectionDomNode): ProjectionNodeAnnotation {
  const raw = attr(node, PROJECTION_RANGE_ATTR);
  const atomic = attr(node, PROJECTION_ATOMIC_ATTR) === 'true';
  let range: ProjectionTextRange | null = null;
  let malformed = false;
  let detail: string | null = null;

  if (raw != null) {
    const match = /^(\d+):(\d+)$/.exec(raw);
    if (!match) {
      malformed = true;
      detail = `Invalid ${PROJECTION_RANGE_ATTR} value "${raw}".`;
    } else {
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
        malformed = true;
        detail = `Invalid ${PROJECTION_RANGE_ATTR} bounds "${raw}".`;
      } else {
        range = { start, end };
      }
    }
  }

  if (atomic && range == null) {
    malformed = true;
    detail ??= `Atomic projection node is missing a parseable ${PROJECTION_RANGE_ATTR}.`;
  }

  return { range, atomic, malformed, detail };
}

export function projectionNodeHeadingLevel(node: ProjectionDomNode): number | null {
  const tagName = node.tagName?.toLowerCase();
  if (!tagName) return null;
  const match = /^h([1-6])$/.exec(tagName);
  return match ? Number(match[1]) : null;
}

export function projectionNodeTextValue(node: ProjectionDomNode): string {
  return node.value ?? '';
}

function projectionNodeTagName(node: ProjectionDomNode): string | undefined {
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

  const annotation = projectionNodeAnnotation(node);
  if (annotation.atomic && annotation.range) {
    return projection.slice(annotation.range.start, annotation.range.end);
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
