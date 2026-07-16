import {
  isProjectionTextNode,
  projectionNodeChildren,
  projectionNodeHeadingLevel,
  projectionNodeIsAtomic,
  projectionNodeRange,
  projectionNodeTextValue,
  renderedProjectionChildTexts,
  renderedProjectionText,
  type ProjectionDomNode,
  type ProjectionTextRange,
} from './rendered-projection-text';

const DEFAULT_CONTEXT_CHARS = 64;

export interface AnchorSelector {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  heading_path: string[];
  projection_version: number;
}

export type AnchorCaptureFailureReason =
  | 'collapsed_selection'
  | 'endpoint_inside_atomic'
  | 'endpoint_outside_projection'
  | 'invalid_selection'
  | 'missing_projection_annotation'
  | 'selection_crosses_atomic';

export interface AnchorCaptureFailure {
  ok: false;
  reason: AnchorCaptureFailureReason;
  detail: string;
}

export interface AnchorCaptureSuccess {
  ok: true;
  selector: AnchorSelector;
}

export type AnchorCaptureResult = AnchorCaptureSuccess | AnchorCaptureFailure;

export interface AnchorCaptureEndpoint<N extends AnchorCaptureNode = AnchorCaptureNode> {
  node: N;
  offset: number;
}

export interface AnchorCaptureInput<N extends AnchorCaptureNode = AnchorCaptureNode> {
  root: N;
  plainText: string;
  projectionVersion: number;
  start: AnchorCaptureEndpoint<N>;
  end: AnchorCaptureEndpoint<N>;
  contextChars?: number;
}

export interface AnchorCaptureNode extends ProjectionDomNode {
  childNodes?: AnchorCaptureNode[];
}

type EndpointRole = 'start' | 'end';

interface IndexedNode<N extends AnchorCaptureNode> {
  node: N;
  parent: IndexedNode<N> | null;
  children: IndexedNode<N>[];
  order: number;
  range: ProjectionTextRange | null;
  atomic: boolean;
  headingLevel: number | null;
  subtreeStart: number | null;
  subtreeEnd: number | null;
}

interface ProjectionIndex<N extends AnchorCaptureNode> {
  nodes: IndexedNode<N>[];
  byNode: Map<N, IndexedNode<N>>;
  atomicRanges: ProjectionTextRange[];
}

interface OffsetCaptureSuccess {
  ok: true;
  offset: number;
}

type OffsetCaptureResult = OffsetCaptureSuccess | AnchorCaptureFailure;

/**
 * Capture a W3C-style Anchor selector from a Document Version Projection and a
 * structural selection.
 *
 * Atomic placeholder clamp rule: placeholder tokens are excluded, never
 * included. An endpoint that lands on an atomic boundary is clamped to the
 * nearest offset that keeps the token out of the captured selector. A selection
 * strictly inside an atomic node fails with `endpoint_inside_atomic`; a
 * continuous selection that would cross an atomic range fails with
 * `selection_crosses_atomic`.
 */
export function captureAnchorSelector<N extends AnchorCaptureNode>(
  input: AnchorCaptureInput<N>,
): AnchorCaptureResult {
  if (input.start.node === input.end.node && input.start.offset === input.end.offset) {
    return failure('collapsed_selection', 'Selection is collapsed.');
  }

  const index = buildProjectionIndex(input.root);
  const start = captureEndpointOffset(input, index, input.start, 'start');
  if (!start.ok) return start;

  const end = captureEndpointOffset(input, index, input.end, 'end');
  if (!end.ok) return end;

  if (start.offset === end.offset) {
    return failure('collapsed_selection', 'Selection is collapsed after projection mapping.');
  }
  if (start.offset > end.offset) {
    return failure(
      'invalid_selection',
      `Selection start ${start.offset} is after end ${end.offset}.`,
    );
  }
  if (start.offset < 0 || end.offset > input.plainText.length) {
    return failure(
      'endpoint_outside_projection',
      `Selection offsets ${start.offset}:${end.offset} are outside the projection.`,
    );
  }

  const crossedAtomic = index.atomicRanges.find((range) => overlaps(start.offset, end.offset, range));
  if (crossedAtomic) {
    return failure(
      'selection_crosses_atomic',
      `Selection crosses atomic projection range ${crossedAtomic.start}:${crossedAtomic.end}.`,
    );
  }

  const contextChars = input.contextChars ?? DEFAULT_CONTEXT_CHARS;
  return {
    ok: true,
    selector: {
      exact: input.plainText.slice(start.offset, end.offset),
      prefix: input.plainText.slice(Math.max(0, start.offset - contextChars), start.offset),
      suffix: input.plainText.slice(end.offset, Math.min(input.plainText.length, end.offset + contextChars)),
      start: start.offset,
      end: end.offset,
      heading_path: headingPathAt(index, input.plainText, start.offset),
      projection_version: input.projectionVersion,
    },
  };
}

function captureEndpointOffset<N extends AnchorCaptureNode>(
  input: AnchorCaptureInput<N>,
  index: ProjectionIndex<N>,
  endpoint: AnchorCaptureEndpoint<N>,
  role: EndpointRole,
): OffsetCaptureResult {
  const info = index.byNode.get(endpoint.node);
  if (!info) {
    return failure('endpoint_outside_projection', 'Selection endpoint is not inside the projection tree.');
  }
  if (!Number.isInteger(endpoint.offset) || endpoint.offset < 0) {
    return failure('invalid_selection', `Invalid selection offset ${endpoint.offset}.`);
  }

  const atomic = nearestAtomic(info);
  if (atomic) {
    if (atomic !== info) {
      return failure(
        'endpoint_inside_atomic',
        `Selection endpoint is inside atomic projection range ${atomic.range?.start}:${atomic.range?.end}.`,
      );
    }
    return captureAtomicBoundary(atomic, endpoint.offset, role);
  }

  const annotated = nearestAnnotated(info);
  if (annotated) {
    const local = localRenderedOffset(annotated, info, endpoint.offset, input.plainText);
    if (local == null) {
      return failure(
        'missing_projection_annotation',
        'Selection endpoint could not be located inside its annotated projection node.',
      );
    }
    const length = renderedProjectionText(annotated.node, input.plainText).length;
    if (local < 0 || local > length) {
      return failure(
        'endpoint_outside_projection',
        `Selection endpoint offset ${local} is outside annotated text length ${length}.`,
      );
    }
    return { ok: true, offset: annotated.range!.start + local };
  }

  if (isProjectionTextNode(info.node) && info.parent) {
    const textLength = projectionNodeTextValue(info.node).length;
    const indexInParent = info.parent.children.indexOf(info);
    const parentOffset =
      endpoint.offset <= 0
        ? indexInParent
        : endpoint.offset >= textLength
          ? indexInParent + 1
          : role === 'start'
            ? indexInParent
            : indexInParent + 1;
    return captureUnannotatedBoundary(input, info.parent, parentOffset, role);
  }

  return captureUnannotatedBoundary(input, info, endpoint.offset, role);
}

function captureAtomicBoundary<N extends AnchorCaptureNode>(
  info: IndexedNode<N>,
  offset: number,
  role: EndpointRole,
): OffsetCaptureResult {
  if (!info.range) {
    return failure('missing_projection_annotation', 'Atomic projection node is missing a projection range.');
  }

  if (info.children.length === 0) {
    return { ok: true, offset: role === 'start' ? info.range.end : info.range.start };
  }

  if (offset === 0) {
    return { ok: true, offset: role === 'start' ? info.range.end : info.range.start };
  }
  if (offset === info.children.length) {
    return { ok: true, offset: role === 'end' ? info.range.start : info.range.end };
  }
  if (offset > info.children.length) {
    return failure('invalid_selection', `Invalid atomic selection offset ${offset}.`);
  }

  return failure(
    'endpoint_inside_atomic',
    `Selection endpoint is inside atomic projection range ${info.range.start}:${info.range.end}.`,
  );
}

function captureUnannotatedBoundary<N extends AnchorCaptureNode>(
  input: AnchorCaptureInput<N>,
  info: IndexedNode<N>,
  offset: number,
  role: EndpointRole,
): OffsetCaptureResult {
  if (offset > info.children.length) {
    return failure('invalid_selection', `Invalid child offset ${offset}.`);
  }

  const previous = findPreviousProjectedChild(info, offset);
  const next = findNextProjectedChild(info, offset);

  if (previous && next) {
    return { ok: true, offset: role === 'start' ? previous.subtreeEnd! : next.subtreeStart! };
  }
  if (previous) return { ok: true, offset: previous.subtreeEnd! };
  if (next) return { ok: true, offset: next.subtreeStart! };
  if (info.parent === null && input.plainText.length === 0) return { ok: true, offset: 0 };

  return failure(
    'endpoint_outside_projection',
    'Selection endpoint is outside any annotated projection range.',
  );
}

function buildProjectionIndex<N extends AnchorCaptureNode>(root: N): ProjectionIndex<N> {
  let order = 0;
  const nodes: IndexedNode<N>[] = [];
  const byNode = new Map<N, IndexedNode<N>>();
  const atomicRanges: ProjectionTextRange[] = [];

  function walk(node: N, parent: IndexedNode<N> | null): IndexedNode<N> {
    const info: IndexedNode<N> = {
      node,
      parent,
      children: [],
      order: order++,
      range: projectionNodeRange(node),
      atomic: projectionNodeIsAtomic(node),
      headingLevel: projectionNodeHeadingLevel(node),
      subtreeStart: null,
      subtreeEnd: null,
    };
    nodes.push(info);
    byNode.set(node, info);
    info.children = (projectionNodeChildren(node) as N[]).map((child) => walk(child, info));

    const starts = info.children
      .map((child) => child.subtreeStart)
      .filter((value): value is number => value != null);
    const ends = info.children
      .map((child) => child.subtreeEnd)
      .filter((value): value is number => value != null);

    if (info.range) {
      starts.push(info.range.start);
      ends.push(info.range.end);
      if (info.atomic) atomicRanges.push(info.range);
    }

    info.subtreeStart = starts.length > 0 ? Math.min(...starts) : null;
    info.subtreeEnd = ends.length > 0 ? Math.max(...ends) : null;

    return info;
  }

  walk(root, null);
  return { nodes, byNode, atomicRanges };
}

function localRenderedOffset<N extends AnchorCaptureNode>(
  ancestor: IndexedNode<N>,
  target: IndexedNode<N>,
  targetOffset: number,
  projection: string,
): number | null {
  if (!isAncestor(ancestor, target)) return null;

  if (ancestor === target) {
    if (isProjectionTextNode(target.node)) {
      const length = projectionNodeTextValue(target.node).length;
      return targetOffset <= length ? targetOffset : null;
    }
    return renderedChildBoundaryOffset(target, targetOffset, projection);
  }

  const child = directChildOnPath(ancestor, target);
  if (!child) return null;

  const childOffset = localRenderedOffset(child, target, targetOffset, projection);
  if (childOffset == null) return null;

  const childText = renderedProjectionChildTexts(ancestor.node, projection).find(
    (part) => part.child === child.node,
  );
  if (!childText) return null;

  const raw = renderedProjectionText(child.node, projection);
  const leadingTrim = raw.length - childText.text.length;
  const adjustedChildOffset =
    leadingTrim > 0 && raw.endsWith(childText.text)
      ? Math.max(0, childOffset - leadingTrim)
      : childOffset;

  return childText.start + Math.min(adjustedChildOffset, childText.text.length);
}

function renderedChildBoundaryOffset<N extends AnchorCaptureNode>(
  info: IndexedNode<N>,
  offset: number,
  projection: string,
): number | null {
  if (offset > info.children.length) return null;
  if (offset === 0) return 0;

  const parts = renderedProjectionChildTexts(info.node, projection);
  if (offset >= info.children.length) return renderedProjectionText(info.node, projection).length;

  const previous = parts[offset - 1];
  return previous ? previous.end : 0;
}

function directChildOnPath<N extends AnchorCaptureNode>(
  ancestor: IndexedNode<N>,
  target: IndexedNode<N>,
): IndexedNode<N> | null {
  let current: IndexedNode<N> | null = target;
  let child: IndexedNode<N> | null = null;
  while (current && current !== ancestor) {
    child = current;
    current = current.parent;
  }
  return current === ancestor ? child : null;
}

function isAncestor<N extends AnchorCaptureNode>(
  ancestor: IndexedNode<N>,
  target: IndexedNode<N>,
): boolean {
  let current: IndexedNode<N> | null = target;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function nearestAtomic<N extends AnchorCaptureNode>(info: IndexedNode<N>): IndexedNode<N> | null {
  let current: IndexedNode<N> | null = info;
  while (current) {
    if (current.atomic && current.range) return current;
    current = current.parent;
  }
  return null;
}

function nearestAnnotated<N extends AnchorCaptureNode>(info: IndexedNode<N>): IndexedNode<N> | null {
  let current: IndexedNode<N> | null = info;
  while (current) {
    if (current.range) return current;
    current = current.parent;
  }
  return null;
}

function findPreviousProjectedChild<N extends AnchorCaptureNode>(
  info: IndexedNode<N>,
  offset: number,
): IndexedNode<N> | null {
  for (let index = Math.min(offset, info.children.length) - 1; index >= 0; index--) {
    if (info.children[index].subtreeEnd != null) return info.children[index];
  }
  return null;
}

function findNextProjectedChild<N extends AnchorCaptureNode>(
  info: IndexedNode<N>,
  offset: number,
): IndexedNode<N> | null {
  for (let index = offset; index < info.children.length; index++) {
    if (info.children[index].subtreeStart != null) return info.children[index];
  }
  return null;
}

function headingPathAt<N extends AnchorCaptureNode>(
  index: ProjectionIndex<N>,
  projection: string,
  offset: number,
): string[] {
  const stack: Array<{ level: number; text: string }> = [];
  const headings = index.nodes
    .filter((node) => node.headingLevel != null && node.range != null)
    .sort((a, b) => a.order - b.order);

  for (const heading of headings) {
    if (heading.range!.start > offset) break;

    const level = heading.headingLevel!;
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();

    const text = renderedProjectionText(heading.node, projection).trim();
    if (text !== '') stack.push({ level, text });
  }

  return stack.map((heading) => heading.text);
}

function overlaps(start: number, end: number, range: ProjectionTextRange): boolean {
  return start < range.end && end > range.start;
}

function failure(reason: AnchorCaptureFailureReason, detail: string): AnchorCaptureFailure {
  return { ok: false, reason, detail };
}
