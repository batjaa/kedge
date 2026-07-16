import { describe, expect, it } from 'vitest';
import {
  activeHeadingIdForScroll,
  commentControlsFor,
  deriveTocEntriesFromHeadings,
  placeThreadCards,
  threadControlsFor,
} from '@/lib/review-surface-layout';

describe('review surface layout helpers', () => {
  it('derives a stable TOC from rendered heading inputs', () => {
    expect(deriveTocEntriesFromHeadings([
      { tagName: 'h2', text: '  Motivation  ' },
      { tagName: 'h3', text: 'Anchor model', id: 'anchor-model' },
      { tagName: 'h2', text: 'Motivation' },
      { tagName: 'p', text: 'not a heading' },
      { tagName: 'h2', text: '   ' },
    ])).toEqual([
      { id: 'motivation', title: 'Motivation', level: 2 },
      { id: 'anchor-model', title: 'Anchor model', level: 3 },
      { id: 'motivation-2', title: 'Motivation', level: 2 },
    ]);
  });

  it('dedupes explicit heading ids against already emitted auto ids', () => {
    expect(deriveTocEntriesFromHeadings([
      { tagName: 'h2', text: 'Foo' },
      { tagName: 'h2', text: 'Foo' },
      { tagName: 'h2', text: 'Different label', id: 'foo-2' },
    ])).toEqual([
      { id: 'foo', title: 'Foo', level: 2 },
      { id: 'foo-2', title: 'Foo', level: 2 },
      { id: 'foo-2-2', title: 'Different label', level: 2 },
    ]);
  });

  it('chooses the last heading above the sticky scroll-spy offset', () => {
    const headings = [
      { id: 'motivation', top: 100 },
      { id: 'anchor-model', top: 520 },
      { id: 'rollout', top: 900 },
    ];

    expect(activeHeadingIdForScroll(headings, 0, 80)).toBe('motivation');
    expect(activeHeadingIdForScroll(headings, 430, 96)).toBe('anchor-model');
    expect(activeHeadingIdForScroll(headings, 820, 96)).toBe('rollout');
    expect(activeHeadingIdForScroll([], 820, 96)).toBeNull();
  });

  it('stacks crowded thread cards in document-position order', () => {
    expect(placeThreadCards([
      { threadId: 1, anchorY: 10, height: 100 },
      { threadId: 2, anchorY: 50, height: 80 },
      { threadId: 3, anchorY: 250, height: 60 },
    ], { minGap: 10 })).toEqual([
      { threadId: 1, anchorY: 10, y: 10, connectorOffset: 0, stacked: false },
      { threadId: 2, anchorY: 50, y: 120, connectorOffset: -70, stacked: true },
      { threadId: 3, anchorY: 250, y: 250, connectorOffset: 0, stacked: false },
    ]);
  });

  it('sorts unsorted thread card inputs by anchor position before placement', () => {
    expect(placeThreadCards([
      { threadId: 3, anchorY: 250, height: 60 },
      { threadId: 1, anchorY: 10, height: 100 },
      { threadId: 2, anchorY: 50, height: 80 },
    ], { minGap: 10 })).toEqual([
      { threadId: 1, anchorY: 10, y: 10, connectorOffset: 0, stacked: false },
      { threadId: 2, anchorY: 50, y: 120, connectorOffset: -70, stacked: true },
      { threadId: 3, anchorY: 250, y: 250, connectorOffset: 0, stacked: false },
    ]);
  });

  it('keeps non-overlapping cards aligned to their anchors', () => {
    expect(placeThreadCards([
      { threadId: 1, anchorY: 10, height: 24 },
      { threadId: 2, anchorY: 100, height: 24 },
    ], { minGap: 12 })).toEqual([
      { threadId: 1, anchorY: 10, y: 10, connectorOffset: 0, stacked: false },
      { threadId: 2, anchorY: 100, y: 100, connectorOffset: 0, stacked: false },
    ]);
  });

  it('maps memoized capability flags to visible author and reviewer controls', () => {
    expect(threadControlsFor({ status: 'open', can_resolve: true, can_reopen: false })).toEqual({
      resolve: true,
      reopen: false,
    });
    expect(threadControlsFor({ status: 'resolved', can_resolve: false, can_reopen: true })).toEqual({
      resolve: false,
      reopen: true,
    });

    const pendingSuggestion = {
      type: 'suggestion' as const,
      suggestion_status: 'pending' as const,
      is_deleted: false,
      can_edit: true,
      can_delete: true,
      can_fork: true,
      can_resolve_suggestion: true,
    };
    expect(commentControlsFor(pendingSuggestion, true)).toEqual({
      edit: true,
      delete: true,
      fork: true,
      acceptSuggestion: true,
      declineSuggestion: true,
      reopenSuggestion: false,
    });

    expect(commentControlsFor({ ...pendingSuggestion, can_resolve_suggestion: false }, true)).toMatchObject({
      acceptSuggestion: false,
      declineSuggestion: false,
      reopenSuggestion: false,
    });
  });
});
