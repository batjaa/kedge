import { describe, expect, it } from 'vitest';
import {
  highlightedTextSlicesForSegment,
  projectionRangeFromAttribute,
  threadIdsFromAttribute,
} from '@/lib/anchor-highlight-dom';

describe('anchor highlight DOM helpers', () => {
  it('uses canonical projection annotation parsing for data-prange values', () => {
    expect(projectionRangeFromAttribute('3:9')).toEqual({ start: 3, end: 9 });
    expect(projectionRangeFromAttribute('9:3')).toBeNull();
    expect(projectionRangeFromAttribute('9007199254740992:9007199254740993')).toBeNull();
  });

  it('slices a text segment to the selected span instead of highlighting the whole block', () => {
    expect(highlightedTextSlicesForSegment(0, 28, [{ id: 17, start: 10, end: 16 }])).toEqual([
      { start: 10, end: 16, threadIds: [17] },
    ]);
  });

  it('parses comma and whitespace separated thread ids during migration from element highlights', () => {
    expect(threadIdsFromAttribute('4,5 6')).toEqual([4, 5, 6]);
  });
});
