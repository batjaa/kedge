import type { MentionCandidate } from './thread-types';

export interface MentionTrigger {
  start: number;
  end: number;
  query: string;
}

const TRIGGER_PATTERN = /(^|[\s([{])@([A-Za-z0-9._-]{0,80})$/;

export function findMentionTrigger(value: string, caret: number): MentionTrigger | null {
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(TRIGGER_PATTERN);
  if (!match) return null;

  const prefix = match[1] ?? '';
  const query = match[2] ?? '';
  const start = caret - query.length - 1;

  return {
    start,
    end: caret,
    query,
  };
}

export function mentionToken(candidate: MentionCandidate): string {
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
