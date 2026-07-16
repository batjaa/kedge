import { describe, expect, test } from 'vitest';
import { findMentionTrigger, insertMentionToken, mentionToken } from '@/lib/mention-tokens';

describe('mention token helpers', () => {
  test('finds the active @ trigger at the caret', () => {
    expect(findMentionTrigger('please ask @ali', 'please ask @ali'.length)).toEqual({
      start: 11,
      end: 15,
      query: 'ali',
    });
  });

  test('inserts a persisted mention token and leaves the caret after it', () => {
    const trigger = findMentionTrigger('please ask @ali today', 'please ask @ali'.length);
    if (!trigger) throw new Error('trigger missing');

    const result = insertMentionToken('please ask @ali today', trigger, { id: 42, name: 'Alice Reviewer' });

    expect(result.value).toBe('please ask [@Alice Reviewer](mention:42) today');
    expect(result.caret).toBe('please ask [@Alice Reviewer](mention:42)'.length);
  });

  test('sanitizes candidate names before building markdown', () => {
    expect(mentionToken({ id: 7, name: 'A] (bad)' })).toBe('[@A bad](mention:7)');
  });
});
