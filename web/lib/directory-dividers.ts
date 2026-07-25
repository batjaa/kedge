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
// Why client-side over a server field: server reads (page 1 + each Load-more
// page) arrive strictly path-ordered, so same-directory rows are contiguous and a
// page boundary can at worst repeat a dirname label, never interleave two
// directories — deriving over the loaded rows needs no page-boundary bookkeeping.
// The ONE order this does not control is a live scan/paste injection (#118), which
// PREPENDS freshly-imported rows so the author watches them settle at the top;
// until the next server read reorders them, a just-imported row can sit out of its
// path slot and briefly repeat its directory's label below. That repeat is
// tolerated by the same design that tolerates a page-boundary repeat: every
// divider is inert and key-safe (below), and the next server-ordered read heals it.

/** The label for a repository-root file — a stable path token, not prose. */
export const ROOT_DIRECTORY = '/';

/**
 * The directory a repo-section row clusters under: the dirname of its
 * repo-relative path, {@link ROOT_DIRECTORY} for a root-level file (so a root
 * file is its OWN cluster, not silently folded into the preceding one — a real
 * dirname change deserves a boundary), or `null` for a non-repo row that carries
 * no section-relevant path (never expected in a repo section) and so gets no
 * divider. Read from the provenance descriptor's `path` — the same `tracked_path`
 * the server path-orders by (#118) — so the client's clustering and the server's
 * ordering are the same data and can never disagree.
 */
export function rowDirectory(item: DocumentListItem): string | null {
  const path = item.source?.kind === 'repo' ? item.source.path : undefined;
  if (!path) return null; // not a repo-section row → no directory, no divider
  const slash = path.lastIndexOf('/');
  if (slash <= 0) return ROOT_DIRECTORY; // "README.md" or a defensive "/leading"
  return path.slice(0, slash);
}

/** A rendered entry in a repo section: a real document row, or a directory divider. */
export type SectionEntry =
  | { kind: 'row'; item: DocumentListItem }
  | { kind: 'divider'; dir: string; key: string };

/**
 * Interleave directory dividers into a repo section's path-ordered rows (story 3).
 * A divider labeled with the directory precedes a row whenever that row opens a
 * new (sub)directory cluster — i.e. its dirname differs from the row before it.
 * Because `prevDir` starts as `null`, the FIRST cluster is treated as a change and
 * gets a leading label, so every cluster is labeled (not just the ones after the
 * first). Consequences that fall out of the single rule, all intended:
 *
 * - **Root-level files** cluster under {@link ROOT_DIRECTORY} (`/`), so a root file
 *   after a sub-directory (path order can place e.g. `zzz.md` after `docs/…`) opens
 *   a `/` cluster rather than reading as part of the preceding one. Only a non-repo
 *   row (dirname `null`) is unlabeled.
 * - **A repeated label is tolerated.** Path order can legitimately place a nested
 *   directory between two files of its parent (`docs/a.md` < `docs/guide/x.md` <
 *   `docs/overview.md`), producing `docs` · `docs/guide` · `docs`; a Load-more
 *   boundary can repeat the boundary directory; and a live-injected row (above) can
 *   repeat one transiently. Each divider is keyed by the row it precedes, so repeats
 *   never collide, and each is inert, so a repeat is harmless.
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
