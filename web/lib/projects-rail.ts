import type { Project, WorkspaceSummary } from './document-types';

/**
 * The Unfiled bucket's document count for the dashboard projects rail (#104),
 * DERIVED rather than re-queried. Every document is either filed under exactly
 * one project or is Unfiled, so `total = Σ filed + unfiled`; this inverts that
 * identity from two counts the server already returns authoritatively — the
 * workspace's `documents.total` (the summary) minus the sum of every project's
 * `documents_count` (the projects index). No new endpoint, no re-encoded
 * predicate.
 *
 * Clamped at 0: the summary refreshes live as rows settle (6A) while the seeded
 * per-project counts do not, so a transient skew between the two reads must
 * never render a negative bucket. Returns null when the summary is absent (A1) —
 * the caller keeps the Unfiled card but drops its count, exactly as the stats
 * strip drops its numbers.
 */
export function unfiledDocumentCount(
  summary: WorkspaceSummary | null,
  projects: ReadonlyArray<Pick<Project, 'documents_count'>>,
): number | null {
  if (summary === null) return null;

  const filed = projects.reduce((sum, project) => sum + (project.documents_count ?? 0), 0);

  return Math.max(0, summary.documents.total - filed);
}
