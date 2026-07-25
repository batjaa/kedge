import { describe, expect, it } from 'vitest';
import { rowDirectory, withDirectoryDividers, type SectionEntry } from '@/lib/directory-dividers';
import type { DocumentListItem, DocumentSource } from '@/lib/document-types';

// Directory-divider derivation (M3.10 #119, SPEC §11 story 3) — a pure projection
// over a repo section's path-ordered rows, so the "a divider exactly where the
// directory changes between adjacent rows" contract is proven here without a
// browser. Path ordering is a precondition the server guarantees (#118); these
// cases feed already-ordered rows and assert the boundaries that fall out —
// including the two the spec calls out: a repeated label (tolerated) and
// root-level files.

/** A repo-kind row at `path` (the only shape a repo section holds). */
function repoRow(id: number, path: string): DocumentListItem {
  return item(id, { kind: 'repo', path });
}

function item(id: number, source: DocumentSource): DocumentListItem {
  return {
    id,
    title: `Doc ${id}`,
    status: 'ready',
    last_sync_status: 'ok',
    sync_error: null,
    lifecycle_status: 'draft',
    open_threads_count: 0,
    synced_at: null,
    project: null,
    source,
    tracked_repo_id: 1,
    created_at: null,
  };
}

/** The dividers only, in order — the shape most assertions care about. */
function dividers(entries: SectionEntry[]): string[] {
  return entries.filter((e) => e.kind === 'divider').map((e) => (e as { dir: string }).dir);
}

/** The entry stream as a compact tag list, e.g. ['dir:docs', 'row:1', 'row:2']. */
function shape(entries: SectionEntry[]): string[] {
  return entries.map((e) => (e.kind === 'divider' ? `dir:${e.dir}` : `row:${e.item.id}`));
}

describe('rowDirectory', () => {
  it('returns the dirname of a repo-relative path', () => {
    expect(rowDirectory(repoRow(1, 'docs/rfcs/017-anchoring.md'))).toBe('docs/rfcs');
    expect(rowDirectory(repoRow(2, 'docs/overview.md'))).toBe('docs');
  });

  it('returns null for a root-level file (no directory to label)', () => {
    expect(rowDirectory(repoRow(1, 'README.md'))).toBeNull();
    expect(rowDirectory(repoRow(2, 'LICENSE'))).toBeNull();
  });

  it('returns null for a non-repo row (no section-relevant path)', () => {
    expect(rowDirectory(item(1, { kind: 'upload' }))).toBeNull();
    expect(rowDirectory(item(2, { kind: 'github', repo: 'o/r', path: 'docs/a.md' }))).toBeNull();
    expect(rowDirectory(item(3, { kind: 'url', host: 'example.test' }))).toBeNull();
  });
});

describe('withDirectoryDividers', () => {
  it('is a no-op on an empty section', () => {
    expect(withDirectoryDividers([])).toEqual([]);
  });

  it('labels the first cluster and marks each change between adjacent rows', () => {
    const entries = withDirectoryDividers([
      repoRow(1, 'docs/adr/001-scope.md'),
      repoRow(2, 'docs/adr/002-anchoring.md'),
      repoRow(3, 'docs/specs/m0.md'),
    ]);

    // A leading divider names the first cluster (prevDir starts at "none", so the
    // first sub-directory row IS a change), then one at the docs/adr → docs/specs
    // boundary — and none between the two same-directory adr rows.
    expect(shape(entries)).toEqual(['dir:docs/adr', 'row:1', 'row:2', 'dir:docs/specs', 'row:3']);
  });

  it('emits no divider between adjacent rows in the same directory', () => {
    const entries = withDirectoryDividers([
      repoRow(1, 'docs/a.md'),
      repoRow(2, 'docs/b.md'),
      repoRow(3, 'docs/c.md'),
    ]);
    expect(dividers(entries)).toEqual(['docs']); // one leading label, nothing more
  });

  it('distinguishes sibling nested directories as separate clusters', () => {
    const entries = withDirectoryDividers([
      repoRow(1, 'docs/adr/001.md'),
      repoRow(2, 'docs/specs/m0.md'),
      repoRow(3, 'docs/specs/m1.md'),
    ]);
    expect(dividers(entries)).toEqual(['docs/adr', 'docs/specs']);
  });

  it('tolerates a repeated label when a nested dir sorts between parent-dir files', () => {
    // Real path order: `docs/architecture.md` < `docs/guide/getting-started.md` <
    // `docs/overview.md` — the nested dir lands BETWEEN two parent-dir files, so
    // `docs` legitimately recurs. The derivation emits it each time (never hides a
    // cluster) and the keys stay unique so React never collides on the repeat.
    const entries = withDirectoryDividers([
      repoRow(1, 'docs/architecture.md'),
      repoRow(2, 'docs/guide/getting-started.md'),
      repoRow(3, 'docs/overview.md'),
    ]);

    expect(dividers(entries)).toEqual(['docs', 'docs/guide', 'docs']);
    const keys = entries.filter((e) => e.kind === 'divider').map((e) => (e as { key: string }).key);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate React keys
  });

  it('tolerates a repeated label at a load-more page boundary', () => {
    // Page 1 ends mid-cluster; page 2 begins in the SAME directory. Deriving over
    // the merged list yields ONE divider for that directory — the boundary does
    // not spuriously repeat it (nor interleave), because same-dir rows are
    // contiguous by path order.
    const page1 = [repoRow(1, 'docs/a.md'), repoRow(2, 'docs/b.md')];
    const page2 = [repoRow(3, 'docs/c.md'), repoRow(4, 'spec/x.md')];
    expect(dividers(withDirectoryDividers([...page1, ...page2]))).toEqual(['docs', 'spec']);

    // And when the boundary IS a directory change, the divider lands on the first
    // row of page 2 — never between wrong rows.
    const changed = [repoRow(3, 'guide/c.md'), repoRow(4, 'guide/d.md')];
    expect(shape(withDirectoryDividers([...page1, ...changed]))).toEqual([
      'dir:docs',
      'row:1',
      'row:2',
      'dir:guide',
      'row:3',
      'row:4',
    ]);
  });

  it('gives root-level files no divider, and re-labels a directory that follows them', () => {
    // Path order can place a root file first (`README.md` < `docs/…`) and another
    // after a cluster (`zzz.md` sorts after `docs/…`). Neither gets a divider (no
    // directory to name); the sub-directory between them is labeled once.
    const entries = withDirectoryDividers([
      repoRow(1, 'README.md'),
      repoRow(2, 'docs/a.md'),
      repoRow(3, 'docs/b.md'),
      repoRow(4, 'zzz.md'),
    ]);

    expect(shape(entries)).toEqual(['row:1', 'dir:docs', 'row:2', 'row:3', 'row:4']);
  });
});
