import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, type Diff } from '@sanity/diff-match-patch';
import { describe, expect, it } from 'vitest';
import {
  buildInlineDiff,
  locateAnchorInDiff,
} from '@/lib/inline-diff';

const simpleOps = [
  [DIFF_EQUAL, 'Alpha '],
  [DIFF_DELETE, 'old'],
  [DIFF_INSERT, 'new'],
  [DIFF_EQUAL, ' Omega'],
] satisfies Diff[];

describe('inline diff anchor placement', () => {
  it('places an A-side anchor inside an equal span', () => {
    expect(locateAnchorInDiff(simpleOps, 'a', { start: 2, end: 5 })).toMatchObject({
      side: 'a',
      segmentIndex: 0,
      offset: 2,
      renderedOffset: 2,
    });
  });

  it('places an A-side anchor inside a deleted span', () => {
    expect(locateAnchorInDiff(simpleOps, 'a', { start: 6, end: 9 })).toMatchObject({
      side: 'a',
      segmentIndex: 1,
      offset: 0,
      renderedOffset: 6,
    });
  });

  it('places a B-side anchor inside an inserted span', () => {
    expect(locateAnchorInDiff(simpleOps, 'b', { start: 6, end: 9 })).toMatchObject({
      side: 'b',
      segmentIndex: 2,
      offset: 0,
      renderedOffset: 9,
    });
  });

  it('maps a boundary anchor to the next side-consuming segment', () => {
    expect(locateAnchorInDiff(simpleOps, 'a', { start: 9, end: 15 })).toMatchObject({
      side: 'a',
      segmentIndex: 3,
      offset: 0,
      renderedOffset: 12,
    });
  });

  it('keeps UTF-16 emoji offsets aligned with JavaScript string offsets', () => {
    const prefix = 'Hi ';
    const emoji = '😀';
    const ops = [
      [DIFF_EQUAL, `${prefix}${emoji} `],
      [DIFF_INSERT, 'there'],
    ] satisfies Diff[];

    expect(locateAnchorInDiff(ops, 'a', {
      start: prefix.length,
      end: prefix.length + emoji.length,
    })).toMatchObject({
      segmentIndex: 0,
      offset: 3,
      renderedOffset: 3,
    });
  });
});

describe('inline diff rendering classification', () => {
  it('classifies equal, insertion, and deletion segments from the text diff', () => {
    const segments = buildInlineDiff('Alpha old Omega', 'Alpha new Omega');

    expect(segments.map((segment) => segment.kind)).toEqual(['equal', 'delete', 'insert', 'equal']);
    expect(segments.filter((segment) => segment.kind !== 'insert').map((segment) => segment.text).join('')).toBe(
      'Alpha old Omega',
    );
    expect(segments.filter((segment) => segment.kind !== 'delete').map((segment) => segment.text).join('')).toBe(
      'Alpha new Omega',
    );
  });
});
