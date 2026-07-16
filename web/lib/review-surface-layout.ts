import type { ReviewThread, ThreadComment } from './thread-types';

export interface HeadingInput {
  tagName: string;
  text: string;
  id?: string | null;
}

export interface TocEntry {
  id: string;
  title: string;
  level: number;
}

export interface HeadingPosition {
  id: string;
  top: number;
}

export interface ThreadLayoutInput {
  threadId: number;
  anchorY: number | null;
  height: number;
}

export interface ThreadPlacement {
  threadId: number;
  anchorY: number | null;
  y: number;
  connectorOffset: number | null;
  stacked: boolean;
}

export interface ThreadLayoutOptions {
  minGap?: number;
  topPadding?: number;
}

export interface ThreadControlState {
  resolve: boolean;
  reopen: boolean;
}

export interface CommentControlState {
  edit: boolean;
  delete: boolean;
  fork: boolean;
  acceptSuggestion: boolean;
  declineSuggestion: boolean;
  reopenSuggestion: boolean;
}

export function deriveTocEntriesFromHeadings(headings: HeadingInput[]): TocEntry[] {
  const usedBaseIds = new Map<string, number>();
  const emittedIds = new Set<string>();
  const entries: TocEntry[] = [];

  for (const heading of headings) {
    const level = headingLevel(heading.tagName);
    const title = normalizeHeadingText(heading.text);
    if (level === null || title === '') continue;

    const baseId = slugifyHeading(heading.id || title) || 'section';
    const id = uniqueId(baseId, usedBaseIds, emittedIds);
    entries.push({ id, title, level });
  }

  return entries;
}

export function activeHeadingIdForScroll(
  headings: HeadingPosition[],
  scrollY: number,
  offset = 96,
): string | null {
  if (headings.length === 0) return null;

  const sorted = [...headings].sort((a, b) => a.top - b.top);
  const threshold = scrollY + offset;
  let active = sorted[0].id;

  for (const heading of sorted) {
    if (heading.top > threshold) break;
    active = heading.id;
  }

  return active;
}

export function placeThreadCards(
  inputs: ThreadLayoutInput[],
  options: ThreadLayoutOptions = {},
): ThreadPlacement[] {
  const minGap = options.minGap ?? 16;
  const topPadding = options.topPadding ?? 0;
  let cursor = topPadding;
  const sortedInputs = inputs
    .map((input, index) => ({
      ...input,
      index,
      normalizedAnchorY: finiteNumber(input.anchorY) ? Math.max(topPadding, input.anchorY) : null,
    }))
    .sort((left, right) => {
      if (left.normalizedAnchorY !== null && right.normalizedAnchorY !== null) {
        return left.normalizedAnchorY - right.normalizedAnchorY || left.index - right.index;
      }
      if (left.normalizedAnchorY !== null) return -1;
      if (right.normalizedAnchorY !== null) return 1;
      return left.index - right.index;
    });

  return sortedInputs.map((input) => {
    const anchorY = input.normalizedAnchorY;
    const desiredY = anchorY ?? cursor;
    const y = Math.max(desiredY, cursor);
    const height = Math.max(0, input.height);
    cursor = y + height + minGap;

    return {
      threadId: input.threadId,
      anchorY,
      y,
      connectorOffset: anchorY === null ? null : anchorY - y,
      stacked: anchorY !== null && y > anchorY + 0.5,
    };
  });
}

export function threadControlsFor(
  thread: Pick<ReviewThread, 'status' | 'can_resolve' | 'can_reopen'>,
): ThreadControlState {
  return {
    resolve: thread.status === 'open' && thread.can_resolve,
    reopen: thread.status === 'resolved' && thread.can_reopen,
  };
}

export function commentControlsFor(
  comment: Pick<
    ThreadComment,
    | 'type'
    | 'suggestion_status'
    | 'is_deleted'
    | 'can_edit'
    | 'can_delete'
    | 'can_fork'
    | 'can_resolve_suggestion'
  >,
  isReply: boolean,
): CommentControlState {
  const liveSuggestion = comment.type === 'suggestion' && !comment.is_deleted && comment.suggestion_status !== null;
  const canResolveSuggestion = liveSuggestion && comment.can_resolve_suggestion;

  return {
    edit: comment.can_edit && !comment.is_deleted,
    delete: comment.can_delete && !comment.is_deleted,
    fork: isReply && comment.can_fork && !comment.is_deleted,
    acceptSuggestion: canResolveSuggestion && comment.suggestion_status !== 'accepted',
    declineSuggestion: canResolveSuggestion && comment.suggestion_status !== 'declined',
    reopenSuggestion: canResolveSuggestion && comment.suggestion_status !== 'pending',
  };
}

function headingLevel(tagName: string): number | null {
  const match = /^h([1-6])$/i.exec(tagName);
  return match ? Number(match[1]) : null;
}

function normalizeHeadingText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function slugifyHeading(value: string): string {
  return normalizeHeadingText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueId(baseId: string, usedBaseIds: Map<string, number>, emittedIds: Set<string>): string {
  let count = usedBaseIds.get(baseId) ?? 0;

  while (true) {
    const candidate = count === 0 ? baseId : `${baseId}-${count + 1}`;
    usedBaseIds.set(baseId, count + 1);
    if (!emittedIds.has(candidate)) {
      emittedIds.add(candidate);
      return candidate;
    }
    count += 1;
  }
}

function finiteNumber(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
