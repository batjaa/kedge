import {
  captureAnchorSelector,
  type AnchorCaptureInput,
  type AnchorCaptureNode,
  type AnchorCaptureResult,
} from './anchor-capture-core';
import {
  PROJECTION_ATOMIC_ATTR,
  PROJECTION_RANGE_ATTR,
} from './projection';
import type { ProjectionDomAttribute } from './rendered-projection-text';

export interface BrowserAnchorCaptureInput {
  root: Node;
  plainText: string;
  projectionVersion: number;
  contextChars?: number;
}

export interface BrowserRangeAnchorCaptureInput extends BrowserAnchorCaptureInput {
  range: Range;
}

export interface BrowserSelectionAnchorCaptureInput extends BrowserAnchorCaptureInput {
  selection: Selection | null;
}

export function captureAnchorFromSelection(
  input: BrowserSelectionAnchorCaptureInput,
): AnchorCaptureResult {
  if (!input.selection || input.selection.rangeCount === 0) {
    return {
      ok: false,
      reason: 'collapsed_selection',
      detail: 'No browser selection range is available.',
    };
  }

  return captureAnchorFromRange({
    root: input.root,
    plainText: input.plainText,
    projectionVersion: input.projectionVersion,
    contextChars: input.contextChars,
    range: input.selection.getRangeAt(0),
  });
}

export function captureAnchorFromRange(input: BrowserRangeAnchorCaptureInput): AnchorCaptureResult {
  if (input.range.collapsed) {
    return {
      ok: false,
      reason: 'collapsed_selection',
      detail: 'Selection is collapsed.',
    };
  }

  const adapted = adaptBrowserProjectionTree(input.root);
  const start = adapted.byDomNode.get(input.range.startContainer);
  const end = adapted.byDomNode.get(input.range.endContainer);

  if (!start || !end) {
    return {
      ok: false,
      reason: 'endpoint_outside_projection',
      detail: 'Selection endpoint is outside the projection root.',
    };
  }

  const captureInput: AnchorCaptureInput = {
    root: adapted.root,
    plainText: input.plainText,
    projectionVersion: input.projectionVersion,
    contextChars: input.contextChars,
    start: { node: start, offset: input.range.startOffset },
    end: { node: end, offset: input.range.endOffset },
  };

  return captureAnchorSelector(captureInput);
}

interface BrowserProjectionTree {
  root: AnchorCaptureNode;
  byDomNode: WeakMap<Node, AnchorCaptureNode>;
}

function adaptBrowserProjectionTree(root: Node): BrowserProjectionTree {
  const byDomNode = new WeakMap<Node, AnchorCaptureNode>();

  function walk(node: Node): AnchorCaptureNode {
    const adapted: AnchorCaptureNode =
      node.nodeType === 3
        ? {
            nodeName: '#text',
            value: node.nodeValue ?? '',
          }
        : {
            nodeName: node.nodeName,
            tagName: node.nodeType === 1 ? (node as Element).tagName.toLowerCase() : undefined,
            attrs: node.nodeType === 1 ? projectionAttrs(node as Element) : undefined,
            childNodes: Array.from(node.childNodes).map((child) => walk(child)),
          };

    byDomNode.set(node, adapted);
    return adapted;
  }

  return { root: walk(root), byDomNode };
}

function projectionAttrs(element: Element): ProjectionDomAttribute[] {
  const attrs: ProjectionDomAttribute[] = [];
  const range = element.getAttribute(PROJECTION_RANGE_ATTR);
  if (range != null) attrs.push({ name: PROJECTION_RANGE_ATTR, value: range });

  const atomic = element.getAttribute(PROJECTION_ATOMIC_ATTR);
  if (atomic != null) attrs.push({ name: PROJECTION_ATOMIC_ATTR, value: atomic });

  return attrs;
}
