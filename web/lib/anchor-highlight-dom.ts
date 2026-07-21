import {
  PROJECTION_ATOMIC_ATTR,
  PROJECTION_RANGE_ATTR,
} from './projection';
import {
  projectionNodeAnnotation,
  renderedProjectionChildTexts,
  type ProjectionDomAttribute,
  type ProjectionDomNode,
  type ProjectionNodeAnnotation,
  type ProjectionTextRange,
} from './rendered-projection-text';
import type { ReviewThread } from './thread-types';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const HIGHLIGHT_ATTR = 'data-kedge-anchor-highlight';
const THREAD_IDS_ATTR = 'data-kedge-thread-ids';

const BASE_ANCHOR_CLASSES = [
  'cursor-pointer',
  'rounded',
  'bg-emerald-300/20',
  'box-decoration-clone',
  'border-b-2',
  'border-emerald-500/60',
  'ring-1',
  'ring-inset',
  'ring-emerald-400/20',
  'focus:outline-none',
  'focus-visible:ring-2',
  'focus-visible:ring-emerald-500',
];
const ACTIVE_ANCHOR_CLASSES = ['bg-emerald-300/40', 'ring-2', 'ring-emerald-500/60'];

interface BrowserProjectionNode extends ProjectionDomNode {
  domNode: Node;
  childNodes?: BrowserProjectionNode[];
}

export interface HighlightAnchor {
  id: number;
  start: number;
  end: number;
}

export interface HighlightSlice {
  start: number;
  end: number;
  threadIds: number[];
}

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

export function decorateAnchorHighlights(
  root: HTMLElement,
  threads: ReviewThread[],
  activeThreadId: number | null,
  projectionText: string,
): void {
  clearAnchorHighlights(root);

  const anchors = threads.flatMap((thread): HighlightAnchor[] => {
    if (!thread.anchor || thread.anchor.state === 'orphaned') return [];
    return [{ id: thread.id, start: thread.anchor.start, end: thread.anchor.end }];
  });
  if (anchors.length === 0) return;

  const adapted = adaptBrowserProjectionTree(root);
  for (const segment of collectTextSegments(adapted, projectionText)) {
    const slices = highlightedTextSlicesForSegment(segment.start, segment.end, anchors);
    if (slices.length > 0) wrapTextSegment(segment.node, slices, activeThreadId);
  }
}

/**
 * Toggle the active styling on existing highlight marks WITHOUT rebuilding
 * them. Node identity must survive a hover/active change: a rebuild between
 * mousedown and mouseup disconnects the mousedown target and the browser then
 * never fires the click at all (observed in Chrome), so hover restyling has to
 * happen in place.
 */
export function restyleAnchorHighlights(root: HTMLElement, activeThreadId: number | null): void {
  for (const highlight of Array.from(root.querySelectorAll<HTMLElement>(`[${HIGHLIGHT_ATTR}]`))) {
    const active = activeThreadId != null
      && threadIdsFromAttribute(highlight.getAttribute(THREAD_IDS_ATTR)).includes(activeThreadId);
    for (const cls of ACTIVE_ANCHOR_CLASSES) highlight.classList.toggle(cls, active);
  }
}

export function firstAnchorHighlightForThread(root: HTMLElement | null, threadId: number): HTMLElement | null {
  if (!root) return null;
  for (const element of root.querySelectorAll<HTMLElement>(`[${THREAD_IDS_ATTR}]`)) {
    if (threadIdsFromAttribute(element.getAttribute(THREAD_IDS_ATTR)).includes(threadId)) {
      return element;
    }
  }
  return null;
}

export function threadIdsFromAttribute(raw: string | null | undefined): number[] {
  return (raw ?? '')
    .split(/[\s,]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value));
}

export function projectionRangeFromAttribute(raw: string | null): ProjectionTextRange | null {
  const annotation = projectionNodeAnnotation({
    tagName: 'span',
    attrs: raw == null ? [] : [{ name: PROJECTION_RANGE_ATTR, value: raw }],
  });

  return annotation.range;
}

export function projectionAnnotationForElement(element: Element): ProjectionNodeAnnotation {
  return projectionNodeAnnotation({
    tagName: element.tagName.toLowerCase(),
    attrs: projectionAttrs(element),
  });
}

export function highlightedTextSlicesForSegment(
  segmentStart: number,
  segmentEnd: number,
  anchors: HighlightAnchor[],
): HighlightSlice[] {
  const length = segmentEnd - segmentStart;
  if (length <= 0) return [];

  const overlaps = anchors
    .map((anchor) => ({
      id: anchor.id,
      start: Math.max(segmentStart, anchor.start) - segmentStart,
      end: Math.min(segmentEnd, anchor.end) - segmentStart,
    }))
    .filter((overlap) => overlap.start < overlap.end);
  if (overlaps.length === 0) return [];

  const boundaries = new Set([0, length]);
  for (const overlap of overlaps) {
    boundaries.add(overlap.start);
    boundaries.add(overlap.end);
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const slices: HighlightSlice[] = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const start = sorted[index];
    const end = sorted[index + 1];
    const threadIds = overlaps
      .filter((overlap) => overlap.start < end && start < overlap.end)
      .map((overlap) => overlap.id);

    if (threadIds.length > 0) slices.push({ start, end, threadIds });
  }

  return slices;
}

function clearAnchorHighlights(root: HTMLElement): void {
  for (const highlight of Array.from(root.querySelectorAll<HTMLElement>(`[${HIGHLIGHT_ATTR}]`))) {
    const parent = highlight.parentNode;
    if (!parent) continue;

    while (highlight.firstChild) parent.insertBefore(highlight.firstChild, highlight);
    parent.removeChild(highlight);
    parent.normalize();
  }
}

function collectTextSegments(root: BrowserProjectionNode, projectionText: string): TextSegment[] {
  const segments: TextSegment[] = [];

  function walk(node: BrowserProjectionNode): void {
    const annotation = projectionNodeAnnotation(node);
    if (annotation.malformed || annotation.atomic) return;

    if (annotation.range) {
      collectWithin(node, annotation.range.start);
      return;
    }

    for (const child of node.childNodes ?? []) walk(child);
  }

  function collectWithin(node: BrowserProjectionNode, absoluteBase: number): void {
    for (const part of renderedProjectionChildTexts(node, projectionText)) {
      const child = part.child as BrowserProjectionNode;
      if (child.domNode.nodeType === TEXT_NODE) {
        if (part.start < part.end) {
          segments.push({
            node: child.domNode as Text,
            start: absoluteBase + part.start,
            end: absoluteBase + part.end,
          });
        }
        continue;
      }

      const childAnnotation = projectionNodeAnnotation(child);
      if (childAnnotation.malformed || childAnnotation.atomic) continue;

      if (childAnnotation.range) {
        collectWithin(child, childAnnotation.range.start);
      } else {
        collectWithin(child, absoluteBase + part.start);
      }
    }
  }

  walk(root);
  return segments;
}

function wrapTextSegment(textNode: Text, slices: HighlightSlice[], activeThreadId: number | null): void {
  for (const slice of [...slices].sort((a, b) => b.start - a.start)) {
    wrapTextSlice(textNode, slice, activeThreadId);
  }
}

function wrapTextSlice(textNode: Text, slice: HighlightSlice, activeThreadId: number | null): void {
  if (slice.start >= slice.end || !textNode.parentNode) return;

  const after = textNode.splitText(slice.end);
  const middle = textNode.splitText(slice.start);
  const highlight = textNode.ownerDocument.createElement('mark');
  highlight.setAttribute(HIGHLIGHT_ATTR, 'true');
  highlight.setAttribute(THREAD_IDS_ATTR, slice.threadIds.map(String).join(' '));
  highlight.setAttribute('role', 'button');
  highlight.setAttribute('tabindex', '0');
  highlight.setAttribute('aria-label', slice.threadIds.length === 1 ? 'Open thread' : 'Open threads');
  highlight.classList.add(...BASE_ANCHOR_CLASSES);

  if (activeThreadId != null && slice.threadIds.includes(activeThreadId)) {
    highlight.classList.add(...ACTIVE_ANCHOR_CLASSES);
  }

  after.parentNode?.insertBefore(highlight, after);
  highlight.appendChild(middle);
}

function adaptBrowserProjectionTree(root: Node): BrowserProjectionNode {
  if (root.nodeType === TEXT_NODE) {
    return {
      domNode: root,
      nodeName: '#text',
      value: root.nodeValue ?? '',
    };
  }

  return {
    domNode: root,
    nodeName: root.nodeName,
    tagName: root.nodeType === ELEMENT_NODE ? (root as Element).tagName.toLowerCase() : undefined,
    attrs: root.nodeType === ELEMENT_NODE ? projectionAttrs(root as Element) : undefined,
    childNodes: Array.from(root.childNodes).map((child) => adaptBrowserProjectionTree(child)),
  };
}

function projectionAttrs(element: Element): ProjectionDomAttribute[] {
  const attrs: ProjectionDomAttribute[] = [];
  const range = element.getAttribute(PROJECTION_RANGE_ATTR);
  if (range != null) attrs.push({ name: PROJECTION_RANGE_ATTR, value: range });

  const atomic = element.getAttribute(PROJECTION_ATOMIC_ATTR);
  if (atomic != null) attrs.push({ name: PROJECTION_ATOMIC_ATTR, value: atomic });

  return attrs;
}
