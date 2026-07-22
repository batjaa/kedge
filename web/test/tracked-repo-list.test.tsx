import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TrackedRepoList, TrackedRepoRow } from '@/components/app/tracked-repo-list';
import type { ScanReport, TrackedRepo, TrackedScanStatus } from '@/lib/tracked-repo-scan';

// Static-markup coverage for the tracked-repo panel's per-record states (SPEC §16,
// M3.6, stories 12/14/22): a running scan, a completed report (counts + expandable
// per-file outcomes), and a repo-level failure. Each row is a pure view apart from
// its poller (which renders nothing), so every state renders from props alone.

function render(repo: TrackedRepo): string {
  return renderToStaticMarkup(<TrackedRepoRow repo={repo} onScanned={() => {}} />);
}

describe('TrackedRepoList', () => {
  it('renders nothing when there are no tracked repos', () => {
    expect(renderToStaticMarkup(<TrackedRepoList repos={[]} onScanned={() => {}} />)).toBe('');
  });
});

describe('TrackedRepoRow', () => {
  it('shows a scanning state while the scan is in flight', () => {
    const html = render(repo('running'));
    expect(html).toContain('Scanning the repository');
    expect(html).toContain('role="status"');
    // The repo slug + pattern head the row.
    expect(html).toContain('kedgehq/kedge');
    expect(html).toContain('docs/**');
  });

  it('summarizes a completed scan with counts and an expandable per-file breakdown', () => {
    const html = render(
      repo('ok', report([
        { path: 'docs/spec.md', outcome: 'import_queued', document_id: 1, reason: null },
        { path: 'docs/design.md', outcome: 'import_queued', document_id: 2, reason: null },
        { path: 'docs/old.md', outcome: 'unchanged', document_id: 3, reason: null },
      ])),
    );

    expect(html).toContain('2 queued');
    expect(html).toContain('1 unchanged');
    expect(html).toContain('3 files scanned');
    // Per-file outcomes with badges.
    expect(html).toContain('docs/spec.md');
    expect(html).toContain('Queued');
    expect(html).toContain('Unchanged');
  });

  it('notes a stale-running takeover in the summary', () => {
    const html = render(
      repo('ok', { ...report([]), stale_takeover: true }),
    );
    expect(html).toContain('recovered a stalled scan');
  });

  it('surfaces a repo-level failure message with an alert', () => {
    const failed = repo('failed');
    failed.scan_error = "Couldn't find a branch named \"v1.0.0\".";
    failed.last_scan_report = { ...report([]), status: 'failed', error: { code: 'invalid_ref', message: 'x' } };

    const html = render(failed);
    expect(html).toContain('find a branch named');
    expect(html).toContain('role="alert"');
  });
});

function repo(status: TrackedScanStatus, lastReport: ScanReport | null = null): TrackedRepo {
  return {
    id: 1,
    project_id: 10,
    repo_url: 'https://github.com/kedgehq/kedge',
    ref: 'main',
    path_pattern: 'docs/**',
    last_scan_status: status,
    scan_error: null,
    last_scanned_at: null,
    last_scan_report: lastReport,
    created_at: null,
  };
}

function report(files: ScanReport['files']): ScanReport {
  const counts = { import_queued: 0, unchanged: 0, failed: 0 };
  for (const file of files) counts[file.outcome] += 1;

  return {
    status: 'ok',
    ref: 'main',
    matched: files.length,
    counts,
    files,
    error: null,
    stale_takeover: false,
    started_at: '2026-07-21T00:00:00+00:00',
    finished_at: '2026-07-21T00:00:01+00:00',
    duration_ms: 1000,
  };
}
