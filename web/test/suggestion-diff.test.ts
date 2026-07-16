import { describe, expect, test } from 'vitest';
import { diffSuggestionText } from '@/lib/suggestion-diff';

describe('diffSuggestionText', () => {
  test('marks additions and removals around shared text', () => {
    const diff = diffSuggestionText('Alpha target text', 'Alpha better text');

    expect(diff.before).toContainEqual({ kind: 'removed', value: 'target' });
    expect(diff.after).toContainEqual({ kind: 'added', value: 'better' });
    expect(diff.before.map((token) => token.value).join('')).toBe('Alpha target text');
    expect(diff.after.map((token) => token.value).join('')).toBe('Alpha better text');
  });

  test('represents an empty proposed text as a full removal', () => {
    const diff = diffSuggestionText('Delete this text', '');

    expect(diff.after).toEqual([]);
    expect(diff.before.filter((token) => token.kind === 'removed').map((token) => token.value).join('')).toBe(
      'Delete this text',
    );
  });

  test('keeps identical text unchanged', () => {
    const diff = diffSuggestionText('No change here', 'No change here');

    expect(diff.before.every((token) => token.kind === 'equal')).toBe(true);
    expect(diff.after.every((token) => token.kind === 'equal')).toBe(true);
    expect(diff.before.map((token) => token.value).join('')).toBe('No change here');
    expect(diff.after.map((token) => token.value).join('')).toBe('No change here');
  });

  test('falls back quickly to a coarse diff for very large inputs', () => {
    const before = Array.from({ length: 2000 }, (_, index) => `before-${index}`).join(' ');
    const after = Array.from({ length: 2000 }, (_, index) => `after-${index}`).join(' ');
    const start = performance.now();

    const diff = diffSuggestionText(before, after);

    expect(performance.now() - start).toBeLessThan(250);
    expect(diff.before).toEqual([{ kind: 'removed', value: before }]);
    expect(diff.after).toEqual([{ kind: 'added', value: after }]);
  });
});
