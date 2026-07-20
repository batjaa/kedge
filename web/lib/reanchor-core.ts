const DEFAULT_CONTEXT_CHARS = 64;

export type ReanchorState = 'anchored' | 'orphaned';

export interface ReanchorInputAnchor {
  threadId: number;
  exact: string;
  prefix: string | null;
  suffix: string | null;
  start: number;
  end: number;
}

export interface ReanchorResult {
  threadId: number;
  state: ReanchorState;
  exact: string;
  prefix: string | null;
  suffix: string | null;
  start: number;
  end: number;
}

export function reanchorExact(
  anchors: ReanchorInputAnchor[],
  newPlainText: string,
  contextChars = DEFAULT_CONTEXT_CHARS,
): ReanchorResult[] {
  return anchors.map((anchor) => reanchorOne(anchor, newPlainText, contextChars));
}

function reanchorOne(
  anchor: ReanchorInputAnchor,
  newPlainText: string,
  contextChars: number,
): ReanchorResult {
  const start = findExactMatch(anchor, newPlainText);
  if (start === null) return orphaned(anchor);

  const end = start + anchor.exact.length;

  return {
    threadId: anchor.threadId,
    state: 'anchored',
    exact: anchor.exact,
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
