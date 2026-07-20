import { match as dmpMatch } from '@sanity/diff-match-patch';

const DEFAULT_CONTEXT_CHARS = 64;
const DEFAULT_FUZZY_TIMEOUT_MS = 25;
const FUZZY_SEARCH_DISTANCE = 1000;
const FUZZY_MIN_SIMILARITY = 0.72;

export type ReanchorState = 'anchored' | 'relocated' | 'orphaned';

export interface ReanchorInputAnchor {
  threadId: number;
  exact: string;
  prefix: string | null;
  suffix: string | null;
  start: number;
  end: number;
}

export interface ReanchorOptions {
  contextChars?: number;
  fuzzyTimeoutMs?: number;
  now?: () => number;
  matcher?: FuzzyMatcher;
}

type FuzzyMatcher = (
  text: string,
  pattern: string,
  expectedLocation: number,
  options?: unknown,
) => number;

export interface ReanchorResult {
  threadId: number;
  state: ReanchorState;
  exact: string;
  prefix: string | null;
  suffix: string | null;
  start: number;
  end: number;
}

export function reanchorAnchors(
  anchors: ReanchorInputAnchor[],
  newPlainText: string,
  options: ReanchorOptions = {},
): ReanchorResult[] {
  return anchors.map((anchor) => reanchorOne(anchor, newPlainText, options));
}

export function reanchorExact(
  anchors: ReanchorInputAnchor[],
  newPlainText: string,
  contextChars = DEFAULT_CONTEXT_CHARS,
): ReanchorResult[] {
  return reanchorAnchors(anchors, newPlainText, { contextChars });
}

function reanchorOne(
  anchor: ReanchorInputAnchor,
  newPlainText: string,
  options: ReanchorOptions,
): ReanchorResult {
  const contextChars = options.contextChars ?? DEFAULT_CONTEXT_CHARS;
  const exactStart = findExactMatch(anchor, newPlainText);
  if (exactStart !== null) {
    return anchored(anchor, newPlainText, exactStart, contextChars, 'anchored');
  }

  const relocatedStart = findFuzzyMatch(anchor, newPlainText, options);
  if (relocatedStart !== null) {
    return anchored(anchor, newPlainText, relocatedStart, contextChars, 'relocated');
  }

  return orphaned(anchor);
}

function anchored(
  anchor: ReanchorInputAnchor,
  newPlainText: string,
  start: number,
  contextChars: number,
  state: Extract<ReanchorState, 'anchored' | 'relocated'>,
): ReanchorResult {
  const end = start + anchor.exact.length;
  return {
    threadId: anchor.threadId,
    state,
    exact: newPlainText.slice(start, end),
    prefix: newPlainText.slice(Math.max(0, start - contextChars), start),
    suffix: newPlainText.slice(end, Math.min(newPlainText.length, end + contextChars)),
    start,
    end,
  };
}

function findExactMatch(anchor: ReanchorInputAnchor, newPlainText: string): number | null {
  if (anchor.exact.length === 0) return null;

  const occurrences = allOccurrences(newPlainText, anchor.exact);
  if (occurrences.length === 1) return occurrences[0] ?? null;
  if (occurrences.length === 0) return null;

  const contextual = occurrences.filter((start) => contextMatches(anchor, newPlainText, start));
  return contextual.length === 1 ? contextual[0] ?? null : null;
}

function findFuzzyMatch(
  anchor: ReanchorInputAnchor,
  newPlainText: string,
  options: ReanchorOptions,
): number | null {
  if (anchor.exact.length === 0 || newPlainText.length === 0) return null;

  const now = options.now ?? Date.now;
  const deadline = now() + (options.fuzzyTimeoutMs ?? DEFAULT_FUZZY_TIMEOUT_MS);
  if (now() >= deadline) return null;

  const windowStart = Math.max(0, anchor.start - FUZZY_SEARCH_DISTANCE);
  const windowEnd = Math.min(
    newPlainText.length,
    anchor.start + anchor.exact.length + FUZZY_SEARCH_DISTANCE,
  );
  const searchText = newPlainText.slice(windowStart, windowEnd);
  const expectedLocation = Math.min(
    searchText.length,
    Math.max(0, anchor.start - windowStart),
  );
  const matcher = options.matcher ?? defaultFuzzyMatcher;
  const found = matcher(searchText, anchor.exact, expectedLocation, {
    matchDistance: FUZZY_SEARCH_DISTANCE,
    matchThreshold: 1 - FUZZY_MIN_SIMILARITY,
  });

  if (now() >= deadline || found < 0) return null;

  const start = windowStart + found;
  const candidate = newPlainText.slice(start, start + anchor.exact.length);
  if (normalizedSimilarity(anchor.exact, candidate) < FUZZY_MIN_SIMILARITY) return null;

  return start;
}

// diff-match-patch only PROPOSES a candidate location; the deterministic
// normalizedSimilarity gate below decides relocated-vs-orphaned, so results
// stay stable and package-version-independent. Injectable for tests.
const defaultFuzzyMatcher: FuzzyMatcher = (text, pattern, expectedLocation, options) =>
  dmpMatch(text, pattern, expectedLocation, options as Parameters<typeof dmpMatch>[3]);

function allOccurrences(haystack: string, needle: string): number[] {
  const starts: number[] = [];
  let fromIndex = 0;

  while (fromIndex <= haystack.length) {
    const found = haystack.indexOf(needle, fromIndex);
    if (found === -1) break;
    starts.push(found);
    fromIndex = found + 1;
  }

  return starts;
}

function contextMatches(anchor: ReanchorInputAnchor, newPlainText: string, start: number): boolean {
  const end = start + anchor.exact.length;
  const hasPrefix = anchor.prefix != null && anchor.prefix.length > 0;
  const hasSuffix = anchor.suffix != null && anchor.suffix.length > 0;

  if (!hasPrefix && !hasSuffix) return false;

  if (hasPrefix) {
    const prefixStart = start - anchor.prefix!.length;
    if (prefixStart < 0 || newPlainText.slice(prefixStart, start) !== anchor.prefix) {
      return false;
    }
  }

  if (hasSuffix && newPlainText.slice(end, end + anchor.suffix!.length) !== anchor.suffix) {
    return false;
  }

  return true;
}

function normalizedSimilarity(left: string, right: string): number {
  const length = Math.max(left.length, right.length);
  if (length === 0) return 1;

  return 1 - levenshteinDistance(left, right) / length;
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const substitution = left.charCodeAt(leftIndex - 1) === right.charCodeAt(rightIndex - 1) ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        previous[rightIndex - 1]! + substitution,
      );
    }

    [previous, current] = [current, previous];
  }

  return previous[right.length]!;
}

function orphaned(anchor: ReanchorInputAnchor): ReanchorResult {
  return {
    threadId: anchor.threadId,
    state: 'orphaned',
    exact: anchor.exact,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
    start: anchor.start,
    end: anchor.end,
  };
}
