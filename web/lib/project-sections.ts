// The project page's source-grouping model (M3.10 #118, SPEC §11) — pure
// projections, no I/O. A project page renders one section per attached tracked
// repo (its docs in repo-path order) plus an "Other documents" section for
// everything else; these helpers name a repo section and decide which section a
// document belongs to. The decision here is the SAME rule the API's per-section
// queries implement (`?tracked_repo=` for a repo section, `?exclude_tracked_repos=`
// for the complement), so the client's live routing and the server's reads can
// never disagree on where a document lives.

/**
 * `owner/repo` from a GitHub repo URL — the compact section header and the
 * tracked-repo panel's row heading (one derivation, shared so they match).
 */
export function repoShortName(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '');
}

/** A section's routing key: an attached repo's id, or the Other-documents bucket. */
export type SectionKey = number | 'other';

/** The literal key for the "Other documents" section. */
export const OTHER_SECTION: SectionKey = 'other';

/**
 * Which source section a document belongs to (#118): a doc whose tracked repo is
 * ATTACHED to this project reads under that repo's section; everything else — a
 * hand/paste import (no tracked repo) or a doc reassigned in from another
 * project's repo (an id not attached here) — reads under "Other documents", so
 * grouping never hides a document and never leaks one into a foreign repo's
 * section. This mirrors the server: `?tracked_repo=id` selects a repo section,
 * `?exclude_tracked_repos=…attached` selects exactly this "everything else".
 */
export function resolveSectionKey(
  trackedRepoId: number | null | undefined,
  attachedRepoIds: ReadonlySet<number>,
): SectionKey {
  return trackedRepoId != null && attachedRepoIds.has(trackedRepoId)
    ? trackedRepoId
    : OTHER_SECTION;
}
