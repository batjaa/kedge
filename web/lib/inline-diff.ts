import {
  cleanupSemantic,
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
  makeDiff,
  type Diff,
} from '@sanity/diff-match-patch';

export type InlineDiffKind = 'equal' | 'delete' | 'insert';
export type DiffAnchorSide = 'a' | 'b';

export interface InlineDiffSegment {
  kind: InlineDiffKind;
  text: string;
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
  renderedStart: number;
  renderedEnd: number;
}

export interface DiffAnchorInput {
  start: number;
  end: number;
}

export interface DiffAnchorPlacement {
  side: DiffAnchorSide;
  segmentIndex: number;
  offset: number;
  renderedOffset: number;
}

interface DiffOffsetPosition {
  segmentIndex: number;
  offset: number;
  renderedOffset: number;
}

export function makeInlineDiffOperations(textA: string, textB: string): Diff[] {
  return cleanupSemantic(makeDiff(textA, textB));
}

export function buildInlineDiff(textA: string, textB: string): InlineDiffSegment[] {
  return inlineDiffSegments(makeInlineDiffOperations(textA, textB));
}

export function inlineDiffSegments(operations: readonly Diff[]): InlineDiffSegment[] {
  const segments: InlineDiffSegment[] = [];
  let aOffset = 0;
  let bOffset = 0;
  let renderedOffset = 0;

  for (const [operation, text] of operations) {
    if (text.length === 0) continue;

    const kind = kindForOperation(operation);
    const aStart = aOffset;
    const bStart = bOffset;

    if (operation !== DIFF_INSERT) aOffset += text.length;
    if (operation !== DIFF_DELETE) bOffset += text.length;

    const renderedStart = renderedOffset;
    renderedOffset += text.length;

    segments.push({
      kind,
      text,
      aStart,
      aEnd: aOffset,
      bStart,
      bEnd: bOffset,
      renderedStart,
      renderedEnd: renderedOffset,
    });
  }

  return segments;
}

export function locateAnchorInDiff(
  operations: readonly Diff[],
  side: DiffAnchorSide,
  anchor: DiffAnchorInput,
): DiffAnchorPlacement | null {
  return locateAnchorInSegments(inlineDiffSegments(operations), side, anchor);
}

export function locateAnchorInSegments(
  segments: readonly InlineDiffSegment[],
  side: DiffAnchorSide,
  anchor: DiffAnchorInput,
): DiffAnchorPlacement | null {
  if (!Number.isSafeInteger(anchor.start) || !Number.isSafeInteger(anchor.end) || anchor.end <= anchor.start) {
    return null;
  }

  const start = locateOffsetInSegments(segments, side, anchor.start, 'start');
  if (!start || !locateOffsetInSegments(segments, side, anchor.end, 'end')) return null;

  return {
    side,
    segmentIndex: start.segmentIndex,
    offset: start.offset,
    renderedOffset: start.renderedOffset,
  };
}

function locateOffsetInSegments(
  segments: readonly InlineDiffSegment[],
  side: DiffAnchorSide,
  targetOffset: number,
  affinity: 'start' | 'end',
): DiffOffsetPosition | null {
  let lastConsumedEnd: DiffOffsetPosition | null = null;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    if (!sideConsumesSegment(segment.kind, side)) continue;

    const sourceStart = side === 'a' ? segment.aStart : segment.bStart;
    const sourceEnd = side === 'a' ? segment.aEnd : segment.bEnd;
    const segmentLength = sourceEnd - sourceStart;

    if (affinity === 'start' && targetOffset >= sourceStart && targetOffset < sourceEnd) {
      const offset = targetOffset - sourceStart;
      return {
        segmentIndex: index,
        offset,
        renderedOffset: segment.renderedStart + offset,
      };
    }

    if (affinity === 'end' && targetOffset > sourceStart && targetOffset <= sourceEnd) {
      const offset = targetOffset - sourceStart;
      return {
        segmentIndex: index,
        offset,
        renderedOffset: segment.renderedStart + offset,
      };
    }

    if (targetOffset === sourceEnd) {
      lastConsumedEnd = {
        segmentIndex: index,
        offset: segmentLength,
        renderedOffset: segment.renderedEnd,
      };
    }
  }

  return affinity === 'end' ? lastConsumedEnd : null;
}

function sideConsumesSegment(kind: InlineDiffKind, side: DiffAnchorSide): boolean {
  return kind === 'equal'
    || (side === 'a' && kind === 'delete')
    || (side === 'b' && kind === 'insert');
}

function kindForOperation(operation: Diff[0]): InlineDiffKind {
  if (operation === DIFF_EQUAL) return 'equal';
  if (operation === DIFF_DELETE) return 'delete';
  if (operation === DIFF_INSERT) return 'insert';

  throw new Error(`Unknown diff operation: ${operation}`);
}
