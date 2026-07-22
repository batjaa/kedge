'use client';

import { readTrackedRepo } from '@/lib/tracked-repos-client';
import {
  isScanInFlight,
  scanSettled,
  type ScanReport,
  type TrackedRepo,
} from '@/lib/tracked-repo-scan';
import { usePollUntilSettled } from '@/lib/use-poll-until-settled';

// The tracked repos on a project page (SPEC §16, M3.6, stories 12/14/22): each
// record's state and last-scan report. A running/pending record polls the show
// endpoint until its scan settles (the shared hook's fourth consumer), then the
// settled report's queued imports materialize on the island. A repo-level failure
// (bad ref, revoked PAT, rate limit, truncation, over-cap) surfaces its message; a
// completed scan summarizes its per-outcome counts with an expandable per-file
// breakdown. Pure view apart from the poller, so each state renders statically.

const ERROR_CLASS =
  'mt-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20';

export function TrackedRepoList({
  repos,
  onScanned,
}: {
  repos: TrackedRepo[];
  onScanned: (repo: TrackedRepo) => void;
}) {
  if (repos.length === 0) return null;

  return (
    <ul className="mt-6 space-y-3 border-t border-zinc-900/5 pt-6 dark:border-white/5">
      {repos.map((repo) => (
        <TrackedRepoRow key={repo.id} repo={repo} onScanned={onScanned} />
      ))}
    </ul>
  );
}

export function TrackedRepoRow({
  repo,
  onScanned,
}: {
  repo: TrackedRepo;
  onScanned: (repo: TrackedRepo) => void;
}) {
  const inFlight = isScanInFlight(repo.last_scan_status);
  const report = repo.last_scan_report;

  return (
    <li className="rounded-xl bg-zinc-50 p-3.5 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/[.02] dark:ring-white/10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <code className="font-mono text-sm font-medium text-zinc-900 dark:text-white">
          {repoSlug(repo.repo_url)}
        </code>
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {repo.ref ?? report?.ref ?? 'default'} · {repo.path_pattern}
        </span>
      </div>

      {inFlight ? (
        <p role="status" className="mt-2 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <span
            aria-hidden="true"
            className="size-3.5 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-500"
          />
          Scanning the repository…
        </p>
      ) : repo.last_scan_status === 'failed' ? (
        <p role="alert" className={ERROR_CLASS}>
          {repo.scan_error ?? 'The scan failed. Check the repository details and try again.'}
        </p>
      ) : report ? (
        <ScanReportSummary report={report} />
      ) : (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Not scanned yet.</p>
      )}

      {inFlight ? <ScanPoller id={repo.id} onScanned={onScanned} /> : null}
    </li>
  );
}

function ScanReportSummary({ report }: { report: ScanReport }) {
  const { import_queued, unchanged, failed } = report.counts;

  return (
    <div className="mt-2">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        <span className="font-medium text-emerald-700 dark:text-emerald-400">{import_queued} queued</span>
        {' · '}
        {unchanged} unchanged
        {failed > 0 ? (
          <span className="text-rose-700 dark:text-rose-400">{' · '}{failed} failed</span>
        ) : null}
        {report.stale_takeover ? (
          <span className="text-amber-700 dark:text-amber-400"> · recovered a stalled scan</span>
        ) : null}
      </p>

      {report.files.length > 0 ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
            {report.matched} file{report.matched === 1 ? '' : 's'} scanned
          </summary>
          <ul className="mt-2 divide-y divide-zinc-900/5 rounded-lg ring-1 ring-inset ring-zinc-900/10 dark:divide-white/5 dark:ring-white/10">
            {report.files.map((file) => (
              <li
                key={file.path}
                className="flex items-center justify-between gap-3 px-3 py-1.5"
              >
                <code className="min-w-0 truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
                  {file.path}
                </code>
                <OutcomeBadge outcome={file.outcome} reason={file.reason} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function OutcomeBadge({
  outcome,
  reason,
}: {
  outcome: 'import_queued' | 'unchanged' | 'failed';
  reason: string | null;
}) {
  if (outcome === 'import_queued') {
    return (
      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300">
        Queued
      </span>
    );
  }

  if (outcome === 'failed') {
    return (
      <span
        title={reason ?? undefined}
        className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-400/10 dark:text-rose-300"
      >
        Failed
      </span>
    );
  }

  return (
    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-400">
      Unchanged
    </span>
  );
}

/**
 * One in-flight tracked repo's poll loop — the shared hook's fourth consumer. It
 * polls the show endpoint until the scan settles, then hands the settled record up
 * so the row re-renders and its queued imports materialize. Renders nothing.
 */
function ScanPoller({ id, onScanned }: { id: number; onScanned: (repo: TrackedRepo) => void }) {
  usePollUntilSettled<TrackedRepo>({
    poll: async () => scanSettled(await readTrackedRepo(id)),
    onSettled: onScanned,
    deps: [id, onScanned],
  });

  return null;
}

/** `owner/repo` from a GitHub repo URL, for a compact row heading. */
function repoSlug(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '');
}
