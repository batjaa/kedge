import { describe, expect, it } from 'vitest';
import { OTHER_SECTION, repoShortName, resolveSectionKey } from '@/lib/project-sections';

// The project page's source bucketing (M3.10 #118, SPEC §11) — a pure rule, so
// the "attached repo → its section, everything else → Other documents" contract
// is proven here without a browser. This mirrors the server's per-section queries
// (`?tracked_repo=` vs `?exclude_tracked_repos=`), so the two can never disagree
// on where a document lives — and grouping never hides one.
describe('resolveSectionKey', () => {
  const attached = new Set([7, 9]);

  it('routes a doc from an attached repo to that repo section', () => {
    expect(resolveSectionKey(7, attached)).toBe(7);
    expect(resolveSectionKey(9, attached)).toBe(9);
  });

  it('routes a hand/paste import (no tracked repo) to Other documents', () => {
    expect(resolveSectionKey(null, attached)).toBe(OTHER_SECTION);
    expect(resolveSectionKey(undefined, attached)).toBe(OTHER_SECTION);
  });

  it('routes a doc from a repo NOT attached here to Other documents (never hidden)', () => {
    // A doc reassigned in from another project keeps its provenance id; that id is
    // not in this project's attached set, so it belongs to Other — not swallowed
    // into a repo section it does not belong to, and never dropped.
    expect(resolveSectionKey(42, attached)).toBe(OTHER_SECTION);
  });

  it('routes everything to Other when no repos are attached', () => {
    const none = new Set<number>();
    expect(resolveSectionKey(7, none)).toBe(OTHER_SECTION);
    expect(resolveSectionKey(null, none)).toBe(OTHER_SECTION);
  });
});

describe('repoShortName', () => {
  it('reduces a GitHub repo URL to owner/repo', () => {
    expect(repoShortName('https://github.com/kedgehq/kedge')).toBe('kedgehq/kedge');
    expect(repoShortName('http://www.github.com/kedge-fixtures/specs')).toBe('kedge-fixtures/specs');
    expect(repoShortName('https://github.com/owner/repo.git')).toBe('owner/repo');
  });
});
