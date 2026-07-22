// The web-side tracked-repo scan model (SPEC §16, M3.6, #93) — pure types and
// projections, no I/O. Keep in sync with api/app/Http/Resources/V1/TrackedRepoResource.php
// and the ScanReport shape (App\Services\TrackedRepos\ScanReport).
//
// These functions own the two liveness moves the panel makes: deciding when a
// scan has settled (the shared poll hook's predicate), and turning a settled
// report's `import_queued` outcomes into importing rows the project island
// materializes — which is how the scan closes the M3.5 out-of-band-liveness TODO
// (story 22). Both are pure so they test without a browser.

import type { DocumentListItem } from './document-types';

export type TrackedScanStatus = 'pending' | 'running' | 'ok' | 'failed';

export type ScanOutcome = 'import_queued' | 'unchanged' | 'failed';

/** One matched path's discovery-time outcome (3A). */
export interface ScanFileOutcome {
  path: string;
  outcome: ScanOutcome;
  document_id: number | null;
  reason: string | null;
}

/** The denormalized last-scan report — the panel's poll payload (3A). */
export interface ScanReport {
  status: 'ok' | 'failed';
  ref: string | null;
  matched: number;
  counts: { import_queued: number; unchanged: number; failed: number };
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
 * The `import_queued` outcomes of a settled report, projected into importing
 * document rows the project island can render immediately — each then settles
 * through the existing per-row poll path (story 22). Entries without a document id
 * (a failed/unchanged path) are skipped; duplicates by id collapse to one.
 */
export function reportImportingRows(report: ScanReport | null): DocumentListItem[] {
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
      // A scan-imported doc is filed into the repo's project by the API; the row
      // already lives on that project's list, so the chip is implicit.
      project: null,
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
