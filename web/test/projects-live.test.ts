import { describe, expect, it } from 'vitest';
import { nextProjects } from '@/lib/projects-live';
import type { Project } from '@/lib/document-types';

// The rail's refresh-merge rule (#104, 6A generalized): a real read replaces, a
// transient miss keeps the last-good counts rather than blanking the rail
// mid-session. Mirrors nextSummary.
describe('nextProjects', () => {
  const current = [project({ id: 1, name: 'Anchoring', documents_count: 6 })];

  it('replaces the rail with a fresh read', () => {
    const fetched = [project({ id: 1, name: 'Anchoring', documents_count: 7 })];
    expect(nextProjects(current, fetched)).toBe(fetched);
  });

  it('keeps the last-good rail when a refresh fails (null)', () => {
    expect(nextProjects(current, null)).toBe(current);
  });

  it('accepts a genuinely empty read (every project deleted) — not treated as a miss', () => {
    expect(nextProjects(current, [])).toEqual([]);
  });
});

function project(overrides: Partial<Project> & { id: number }): Project {
  return {
    name: 'Untitled',
    slug: 'untitled',
    description: null,
    created_at: null,
    ...overrides,
  };
}
