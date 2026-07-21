import { describe, expect, it } from 'vitest';
import { groupDocumentsByProject, hasNamedGroups } from '@/lib/document-groups';
import type { DocumentListItem, ProjectRef } from '@/lib/document-types';

// The home's project grouping (SPEC 11 + decision 14A) — a pure projection, so
// the ordering rules (named groups alphabetical, Unfiled always last) are proven
// here without a browser. This is the cheapest, most exhaustive place to lock
// the ordering the grouped list renders.
describe('groupDocumentsByProject', () => {
  it('orders named groups alphabetically and puts Unfiled last (14A)', () => {
    const groups = groupDocumentsByProject([
      item({ id: 1, project: null }),
      item({ id: 2, project: { id: 20, name: 'Zebra' } }),
      item({ id: 3, project: { id: 10, name: 'Anchoring' } }),
    ]);

    expect(groups.map((group) => group.project?.name ?? 'Unfiled')).toEqual([
      'Anchoring',
      'Zebra',
      'Unfiled',
    ]);
  });

  it('is case-insensitive when ordering names', () => {
    const groups = groupDocumentsByProject([
      item({ id: 1, project: { id: 1, name: 'beta' } }),
      item({ id: 2, project: { id: 2, name: 'Alpha' } }),
      item({ id: 3, project: { id: 3, name: 'Gamma' } }),
    ]);

    expect(groups.map((group) => group.project?.name)).toEqual(['Alpha', 'beta', 'Gamma']);
  });

  it('keeps each project a single group and preserves row order within it', () => {
    const groups = groupDocumentsByProject([
      item({ id: 1, project: { id: 10, name: 'Anchoring' } }),
      item({ id: 2, project: null }),
      item({ id: 3, project: { id: 10, name: 'Anchoring' } }),
    ]);

    expect(groups).toHaveLength(2);
    const anchoring = groups[0];
    expect(anchoring.project?.id).toBe(10);
    // Rows 1 then 3, in the order they arrived (the list's newest-first order).
    expect(anchoring.items.map((row) => row.id)).toEqual([1, 3]);
  });

  it('breaks equal names by id so equal-named groups never reshuffle', () => {
    const groups = groupDocumentsByProject([
      item({ id: 1, project: { id: 30, name: 'Docs' } }),
      item({ id: 2, project: { id: 12, name: 'Docs' } }),
    ]);

    expect(groups.map((group) => group.project?.id)).toEqual([12, 30]);
  });

  it('omits the Unfiled bucket entirely when every row is filed', () => {
    const groups = groupDocumentsByProject([
      item({ id: 1, project: { id: 10, name: 'Anchoring' } }),
    ]);

    expect(groups.every((group) => group.project !== null)).toBe(true);
  });

  it('yields a single Unfiled group when nothing is filed', () => {
    const groups = groupDocumentsByProject([
      item({ id: 1, project: null }),
      item({ id: 2, project: null }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].project).toBeNull();
    expect(groups[0].items).toHaveLength(2);
  });
});

describe('hasNamedGroups', () => {
  it('is false when there are no projects — the home reads as today (14A)', () => {
    const groups = groupDocumentsByProject([item({ id: 1, project: null })]);
    expect(hasNamedGroups(groups)).toBe(false);
  });

  it('is true the moment any row carries a project', () => {
    const groups = groupDocumentsByProject([
      item({ id: 1, project: null }),
      item({ id: 2, project: { id: 10, name: 'Anchoring' } }),
    ]);
    expect(hasNamedGroups(groups)).toBe(true);
  });
});

function item(overrides: Partial<DocumentListItem> & { id: number; project: ProjectRef | null }): DocumentListItem {
  return {
    title: 'Untitled',
    status: 'ready',
    last_sync_status: 'ok',
    sync_error: null,
    lifecycle_status: 'draft',
    open_threads_count: 0,
    synced_at: null,
    created_at: null,
    ...overrides,
  };
}
