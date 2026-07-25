import type { DocumentListItem } from './document-types';

// Directory dividers inside a repo section (M3.10 #119, SPEC §11 story 3). A repo
// section renders its docs in repo-path order (#118); this pure projection walks
// those already-loaded rows and marks where one (sub)directory cluster gives way
// to the next, so `docs/adr/` and `docs/specs/` read as clusters without becoming
// a navigable folder tree. The result is presentation-only: the caller renders a
// non-interactive, assistive-tech-decorative divider for each `divider` entry
// (the directory it labels is already announced on every row's provenance chip,
// so the divider adds nothing for a screen reader — it is sight-only sugar).
//
// Why client-side over the loaded rows, not a server field: rows arrive strictly
// path-ordered, so same-directory rows are always contiguous and a Load-more page
// boundary can at WORST repeat a dirname label, never interleave two directories.
// Deriving over the merged list therefore needs no page-boundary bookkeeping.

/**
 * The directory a repo-section row clusters under: the dirname of its
 * repo-relative path, or `null` for a root-level file (no directory to label).
 * Read from the provenance descriptor's `path` — the same `tracked_path` the
 * server path-orders by (#118) — so the client's clustering and the server's
 * ordering are the same data and can never disagree. Only a `repo`-kind row
 * carries a section-relevant path; anything else (never expected in a repo
 * section) yields `null` and simply gets no divider.
 */
export function rowDirectory(item: DocumentListItem): string | null {
  const path = item.source?.kind === 'repo' ? item.source.path : undefined;
  if (!path) return null;
  const slash = path.lastIndexOf('/');
  if (slash === -1) return null; // root-level file: no directory
  const dir = path.slice(0, slash);
  return dir === '' ? null : dir; // defensive: a leading-slash path is rootish
}

/** A rendered entry in a repo section: a real document row, or a directory divider. */
export type SectionEntry =
  | { kind: 'row'; item: DocumentListItem }
  | { kind: 'divider'; dir: string; key: string };

/**
 * Interleave directory dividers into a repo section's path-ordered rows (story 3).
 * A divider labeled with the directory precedes a row whenever that row opens a
 * new (sub)directory cluster — i.e. its dirname differs from the row before it.
 * Because `prevDir` starts as `null`, the FIRST sub-directory row is treated as a
 * change and gets a leading label, so every cluster is labeled (not just the ones
 * after the first). Consequences that fall out of the single rule, all intended:
 *
 * - **Root-level files** (dirname `null`) never emit a divider — there is no
 *   directory to name — and a root file appearing after a sub-directory cluster
 *   (path order can place e.g. `zzz.md` after `docs/…`) simply carries no divider.
 * - **A repeated label is tolerated.** Path order can legitimately place a nested
 *   directory between two files of its parent (`docs/a.md` < `docs/guide/x.md` <
 *   `docs/overview.md`), producing `docs` · `docs/guide` · `docs`; and a Load-more
 *   boundary can repeat the boundary directory. Each divider is keyed by the row
 *   it precedes, so repeats never collide, and each is inert, so a repeat is
 *   harmless.
 *
 * Pure and idempotent: same rows in → same entries out, no I/O, no row mutation.
 */
export function withDirectoryDividers(items: readonly DocumentListItem[]): SectionEntry[] {
  const entries: SectionEntry[] = [];
  let prevDir: string | null = null;
  for (const item of items) {
    const dir = rowDirectory(item);
    if (dir !== null && dir !== prevDir) {
      // Keyed by the following row's id — unique across the section, so a repeated
      // label (a nested dir between parent files, or a page-boundary repeat) never
      // produces a duplicate React key.
      entries.push({ kind: 'divider', dir, key: `dir:${item.id}` });
    }
    entries.push({ kind: 'row', item });
    prevDir = dir;
  }
  return entries;
}
