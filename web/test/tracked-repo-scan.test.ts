import { describe, expect, it } from 'vitest';
import {
  isScanInFlight,
  isUpToDate,
  mergeReportedRows,
  reportImportingRows,
  scanSettled,
  type ScanReport,
  type TrackedRepo,
  type TrackedScanStatus,
} from '@/lib/tracked-repo-scan';
import type { DocumentListItem } from '@/lib/document-types';

// Pure coverage for the scan liveness projections (SPEC §16, M3.6, #93): the poll
// predicate that decides when a scan has settled, and the report → importing-row
// materialization that closes the M3.5 out-of-band-liveness TODO (story 22).

describe('isScanInFlight', () => {
  it('is true while pending or running, false once settled', () => {
    expect(isScanInFlight('pending')).toBe(true);
    expect(isScanInFlight('running')).toBe(true);
    expect(isScanInFlight('ok')).toBe(false);
    expect(isScanInFlight('failed')).toBe(false);
  });
});

describe('scanSettled', () => {
  it('keeps polling on a fetch hiccup (null)', () => {
    expect(scanSettled(null)).toBeNull();
  });

  it('keeps polling while the scan is in flight', () => {
    expect(scanSettled(repo('running'))).toBeNull();
    expect(scanSettled(repo('pending'))).toBeNull();
  });

  it('settles on a terminal status, returning the record', () => {
    const ok = repo('ok');
    expect(scanSettled(ok)).toBe(ok);
    expect(scanSettled(repo('failed'))?.last_scan_status).toBe('failed');
  });
});

describe('reportImportingRows', () => {
  it('returns nothing for a null report', () => {
    expect(reportImportingRows(null)).toEqual([]);
  });

  it('projects only import_queued outcomes with a document id into importing rows', () => {
    const rows = reportImportingRows(
      report([
        { path: 'docs/spec.md', outcome: 'import_queued', document_id: 7, reason: null },
        { path: 'docs/old.md', outcome: 'unchanged', document_id: 3, reason: null },
        { path: 'docs/bad.md', outcome: 'failed', document_id: null, reason: 'nope' },
      ]),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 7, title: 'spec.md', status: 'importing' });
  });

  it('skips re-synced and missing outcomes — those are existing rows, not new imports', () => {
    const rows = reportImportingRows(
      report([
        { path: 'docs/changed.md', outcome: 'resync_queued', document_id: 4, reason: null },
        { path: 'docs/gone.md', outcome: 'missing', document_id: 5, reason: null },
        { path: 'docs/new.md', outcome: 'import_queued', document_id: 6, reason: null },
      ]),
    );

    expect(rows.map((row) => row.id)).toEqual([6]);
  });

  it('dedupes by document id', () => {
    const rows = reportImportingRows(
      report([
        { path: 'docs/a.md', outcome: 'import_queued', document_id: 9, reason: null },
        { path: 'docs/a.md', outcome: 'import_queued', document_id: 9, reason: null },
      ]),
    );

    expect(rows).toHaveLength(1);
  });

  it('stamps rows with the tracked repo project so their chip is correct (B1)', () => {
    const rows = reportImportingRows(
      report([{ path: 'docs/spec.md', outcome: 'import_queued', document_id: 7, reason: null }]),
      { id: 10, name: 'Anchoring' },
    );

    expect(rows[0].project).toEqual({ id: 10, name: 'Anchoring' });
  });

  it('defaults the row project to null when none is given', () => {
    const rows = reportImportingRows(
      report([{ path: 'docs/spec.md', outcome: 'import_queued', document_id: 7, reason: null }]),
    );

    expect(rows[0].project).toBeNull();
  });
});

describe('isUpToDate', () => {
  it('is true when a completed scan changed nothing (all unchanged)', () => {
    expect(
      isUpToDate(
        report([
          { path: 'docs/a.md', outcome: 'unchanged', document_id: 1, reason: null },
          { path: 'docs/b.md', outcome: 'unchanged', document_id: 2, reason: null },
        ]),
      ),
    ).toBe(true);
  });

  it('is false when anything was imported, re-synced, missing, or failed', () => {
    expect(isUpToDate(report([{ path: 'docs/new.md', outcome: 'import_queued', document_id: 1, reason: null }]))).toBe(false);
    expect(isUpToDate(report([{ path: 'docs/c.md', outcome: 'resync_queued', document_id: 1, reason: null }]))).toBe(false);
    expect(isUpToDate(report([{ path: 'docs/g.md', outcome: 'missing', document_id: 1, reason: null }]))).toBe(false);
    expect(isUpToDate(report([{ path: 'docs/x.md', outcome: 'failed', document_id: null, reason: 'x' }]))).toBe(false);
  });
});

describe('mergeReportedRows', () => {
  it('prepends fresh rows and drops ones already in the list, without mutating', () => {
    const items = [item(1), item(2)];
    const merged = mergeReportedRows(items, [item(2), item(3)]);

    expect(merged.map((row) => row.id)).toEqual([3, 1, 2]);
    expect(merged).not.toBe(items);
    expect(items.map((row) => row.id)).toEqual([1, 2]);
  });

  it('returns the same array reference when nothing is new', () => {
    const items = [item(1)];
    expect(mergeReportedRows(items, [item(1)])).toBe(items);
  });
});

function repo(status: TrackedScanStatus): TrackedRepo {
  return {
    id: 1,
    project_id: 10,
    repo_url: 'https://github.com/kedgehq/kedge',
    ref: 'main',
    path_pattern: 'docs/**',
    last_scan_status: status,
    scan_error: null,
    last_scanned_at: null,
    last_scan_report: null,
    created_at: null,
  };
}

function report(files: ScanReport['files']): ScanReport {
  const counts = { import_queued: 0, resync_queued: 0, unchanged: 0, missing: 0, failed: 0 };
  for (const file of files) counts[file.outcome] += 1;

  return {
    status: 'ok',
    ref: 'main',
    matched: files.length - counts.missing,
    counts,
    files,
    error: null,
    stale_takeover: false,
    started_at: '2026-07-21T00:00:00+00:00',
    finished_at: '2026-07-21T00:00:01+00:00',
    duration_ms: 1000,
  };
}

function item(id: number): DocumentListItem {
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
    created_at: null,
  };
}
