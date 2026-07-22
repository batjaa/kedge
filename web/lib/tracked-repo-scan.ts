// The web-side tracked-repo scan model (SPEC §16, M3.6, #93) — pure types and
// projections, no I/O. Keep in sync with api/app/Http/Resources/V1/TrackedRepoResource.php
// and the ScanReport shape (App\Services\TrackedRepos\ScanReport).
//
// These functions own the two liveness moves the panel makes: deciding when a
// scan has settled (the shared poll hook's predicate), and turning a settled
// report's `import_queued` outcomes into importing rows the project island
// materializes — which is how the scan closes the M3.5 out-of-band-liveness TODO
// (story 22). Both are pure so they test without a browser.

import type { DocumentListItem, ProjectRef } from './document-types';

export type TrackedScanStatus = 'pending' | 'running' | 'ok' | 'failed';

// A re-scan (#94) resolves each held path to one of these: a new file imports, a
// changed file re-syncs (comments survive the ladder), an unchanged file no-ops, a
// held file gone from the tree is flagged missing (never deleted), or a path fails
// to become a document at discovery time.
export type ScanOutcome =
  | 'import_queued'
  | 'resync_queued'
  | 'unchanged'
  | 'missing'
  | 'failed';

/** One matched path's discovery-time outcome (3A). */
export interface ScanFileOutcome {
  path: string;
  outcome: ScanOutcome;
  document_id: number | null;
  reason: string | null;
}

/** Per-outcome tallies (mirrors ScanReport::counts on the API). */
export interface ScanCounts {
  import_queued: number;
  resync_queued: number;
  unchanged: number;
  missing: number;
  failed: number;
}

/** The denormalized last-scan report — the panel's poll payload (3A). */
export interface ScanReport {
  status: 'ok' | 'failed';
  ref: string | null;
  matched: number;
  counts: ScanCounts;
  files: ScanFileOutcome[];
  /** Set only on a repo-level failure (bad ref, truncation, over-cap, …). */
  error: { code: string; message: string } | null;
  stale_takeover: boolean;
  started_at: string;
  finished_at: string;
  duration_ms: number;
}

/** A tracked repo as the panel reads it. Mirrors TrackedRepoResource::toArray. */
export interface TrackedRepo {
  id: number;
  project_id: number | null;
  repo_url: string;
  ref: string | null;
  path_pattern: string;
  last_scan_status: TrackedScanStatus;
  scan_error: string | null;
  last_scanned_at: string | null;
  last_scan_report: ScanReport | null;
  created_at: string | null;
}

/**
 * A scan is in flight while the record is `pending` (created, first scan not yet
 * claimed) or `running` (claimed). It has settled once it reaches a terminal
 * `ok` / `failed`. The panel polls exactly the in-flight records.
 */
export function isScanInFlight(status: TrackedScanStatus): boolean {
  return status === 'pending' || status === 'running';
}

/**
 * The shared poll hook's predicate: given a freshly-read record (or null when the
 * poll fetch hiccuped), return it once the scan has settled, or null to keep
 * polling. A failed fetch keeps the loop alive, exactly like the document pollers.
 */
export function scanSettled(repo: TrackedRepo | null): TrackedRepo | null {
  if (repo === null) return null;
  return isScanInFlight(repo.last_scan_status) ? null : repo;
}

/**
 * Whether a completed scan changed nothing — the honest "already up to date"
 * no-op (story 11): a re-scan that queued no imports and no re-syncs, flagged
 * nothing missing, and failed no file. Only meaningful for an `ok` report (a
 * repo-level failure has no per-file outcomes to be up-to-date about).
 */
export function isUpToDate(report: ScanReport): boolean {
  const { import_queued, resync_queued, missing, failed } = report.counts;
  return (
    report.status === 'ok' &&
    import_queued === 0 &&
    resync_queued === 0 &&
    missing === 0 &&
    failed === 0
  );
}

/**
 * The `import_queued` outcomes of a settled report, projected into importing
 * document rows the project island can render immediately — each then settles
 * through the existing per-row poll path (story 22). Only new imports materialize:
 * a re-synced or missing path is an existing row the list already holds, so it is
 * skipped here (its own per-row poll reflects the re-sync). Entries without a
 * document id (a failed path) are skipped; duplicates by id collapse to one.
 *
 * `project` is the tracked repo's project (the page's project): the API files
 * every scan-imported doc under it, so the materialized row must carry it too —
 * otherwise its chip reads "Unfiled" and a home-list settle pins it there until a
 * reload. Null only on a workspace with no project (the panel is project-scoped).
 */
export function reportImportingRows(
  report: ScanReport | null,
  project: ProjectRef | null = null,
): DocumentListItem[] {
  if (report === null) return [];

  const rows: DocumentListItem[] = [];
  const seen = new Set<number>();

  for (const file of report.files) {
    if (file.outcome !== 'import_queued' || file.document_id === null) continue;
    if (seen.has(file.document_id)) continue;
    seen.add(file.document_id);

    rows.push({
      id: file.document_id,
      title: rowTitle(file.path),
      status: 'importing',
      last_sync_status: 'ok',
      sync_error: null,
      lifecycle_status: 'draft',
      open_threads_count: 0,
      synced_at: null,
      // The row carries the repo's project so its chip is correct on sight and a
      // settle never re-buckets it to Unfiled.
      project,
      created_at: null,
    });
  }

  return rows;
}

/**
 * Merge scan-reported importing rows into the island's items, deduped by id like
 * the prepend path: a row already present (e.g. a poll already settled it, or a
 * hand-import minted it) is left untouched — the freshly-reported ones prepend so
 * they show newest-first. Never mutates the input.
 */
export function mergeReportedRows(
  items: DocumentListItem[],
  rows: DocumentListItem[],
): DocumentListItem[] {
  const existing = new Set(items.map((item) => item.id));
  const fresh = rows.filter((row) => !existing.has(row.id));
  return fresh.length === 0 ? items : [...fresh, ...items];
}

/** A readable placeholder title from a repo-relative path (the import overwrites it). */
function rowTitle(path: string): string {
  const base = path.split('/').pop();
  return base && base !== '' ? base : path;
}
