import type { MentionCandidate } from './thread-types';

export interface MentionTrigger {
  start: number;
  end: number;
  query: string;
}

const MAX_TRIGGER_QUERY_LENGTH = 80;
const TRIGGER_PREFIX_PATTERN = /[\s([{]/u;
const TRIGGER_QUERY_PATTERN = /^[\p{L}\p{N} ._-]{0,80}$/u;

export function findMentionTrigger(value: string, caret: number): MentionTrigger | null {
  const beforeCaret = value.slice(0, caret);
  const at = beforeCaret.lastIndexOf('@');
  if (at === -1) return null;

  const prefix = at === 0 ? '' : beforeCaret[at - 1] ?? '';
  if (prefix !== '' && !TRIGGER_PREFIX_PATTERN.test(prefix)) return null;

  const query = beforeCaret.slice(at + 1);
  if (query.length > MAX_TRIGGER_QUERY_LENGTH || !TRIGGER_QUERY_PATTERN.test(query)) return null;

  return {
    start: at,
    end: caret,
    query,
  };
}

export function mentionToken(candidate: MentionCandidate): string {
  // Persisted mention token format: [@Label](mention:id). Keep in sync with
  // api/app/Services/Comments/CommentMentionService.php and web/lib/render-comment-markdown.tsx.
  const label = candidate.name
    .replace(/[\[\]()\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return `[@${label || 'Reviewer'}](mention:${candidate.id})`;
}

export function insertMentionToken(
  value: string,
  trigger: MentionTrigger,
  candidate: MentionCandidate,
): { value: string; caret: number } {
  const token = mentionToken(candidate);
  const before = value.slice(0, trigger.start);
  const after = value.slice(trigger.end);
  const separator = after.startsWith(' ') || after.startsWith('\n') || after === '' ? '' : ' ';
  const nextValue = `${before}${token}${separator}${after}`;

  return {
    value: nextValue,
    caret: before.length + token.length + separator.length,
  };
}
