'use client';

import Link from 'next/link';
import { useState } from 'react';
import { deleteTrackedRepo, readTrackedRepo, rescanTrackedRepo } from '@/lib/tracked-repos-client';
import { runDelete, runRescan } from '@/lib/tracked-repo-actions';
import {
  isScanInFlight,
  isUpToDate,
  isZeroMatch,
  scanSettled,
  type ScanOutcome,
  type ScanReport,
  type TrackedRepo,
} from '@/lib/tracked-repo-scan';
import { importNeedsReconnect } from '@/lib/import-retry';
import { usePollUntilSettled } from '@/lib/use-poll-until-settled';
import { repoShortName } from '@/lib/project-sections';
import { PILL_BASE, ROSE_PANEL } from '@/lib/tracked-repo-styles';

// The tracked repos on a project page (SPEC §16, M3.6, stories 10/11/12/14/16/22):
// each record's state, last-scan report, and its Re-scan / Delete actions. A
// running/pending record polls the show endpoint until its scan settles (the shared
// hook's fourth consumer), then the settled report's queued imports materialize on
// the island. A completed scan summarizes its per-outcome counts (new / re-synced /
// unchanged / missing / failed) with an expandable per-file breakdown, or reads
// "already up to date" when nothing changed. A repo-level failure surfaces its
// message with Re-scan and — when the PAT is dead — an additive Reconnect link
// (never a reconnect-only dead end). Pure view apart from the poller and the row's
// own action state.

const ERROR_CLASS = `mt-2 p-3 ${ROSE_PANEL}`;

const ACTION_CLASS =
  'rounded-full px-3 py-1 text-xs font-medium text-zinc-700 ring-1 ring-inset ring-zinc-900/15 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:text-zinc-200 dark:ring-white/15 dark:hover:bg-white/10';

const DANGER_CLASS =
  'rounded-full px-3 py-1 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-600/20 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-60 dark:text-rose-300 dark:ring-rose-400/20 dark:hover:bg-rose-500/10';

const LINK_CLASS =
  'rounded-full px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-300 dark:ring-emerald-400/20 dark:hover:bg-emerald-400/10';

export function TrackedRepoList({
  repos,
  onScanned,
  onRescanned,
  onRemoved,
}: {
  repos: TrackedRepo[];
  onScanned: (repo: TrackedRepo) => void;
  onRescanned: (repo: TrackedRepo) => void;
  onRemoved: (id: number) => void;
}) {
  if (repos.length === 0) return null;

  return (
    <ul className="mt-6 space-y-3 border-t border-zinc-900/5 pt-6 dark:border-white/5">
      {repos.map((repo) => (
        <TrackedRepoRow
          key={repo.id}
          repo={repo}
          onScanned={onScanned}
          onRescanned={onRescanned}
          onRemoved={onRemoved}
        />
      ))}
    </ul>
  );
}

export function TrackedRepoRow({
  repo,
  onScanned,
  onRescanned,
  onRemoved,
}: {
  repo: TrackedRepo;
  onScanned: (repo: TrackedRepo) => void;
  onRescanned: (repo: TrackedRepo) => void;
  onRemoved: (id: number) => void;
}) {
  const inFlight = isScanInFlight(repo.last_scan_status);
  const report = repo.last_scan_report;

  return (
    <li className="rounded-xl bg-zinc-50 p-3.5 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/[.02] dark:ring-white/10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <code className="font-mono text-sm font-medium text-zinc-900 dark:text-white">
          {repoShortName(repo.repo_url)}
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

      {inFlight ? (
        <ScanPoller id={repo.id} onScanned={onScanned} />
      ) : (
        <RowActions repo={repo} onRescanned={onRescanned} onRemoved={onRemoved} />
      )}
    </li>
  );
}

/**
 * The Re-scan / Delete actions for a settled row. Re-scan is idempotent and always
 * offered; a dead-PAT failure additionally offers Reconnect (additive, never a
 * reconnect-only dead end). Delete is a two-step inline confirm — its documents
 * stay, only tracking goes — and surfaces the 409-while-running message in place.
 */
function RowActions({
  repo,
  onRescanned,
  onRemoved,
}: {
  repo: TrackedRepo;
  onRescanned: (repo: TrackedRepo) => void;
  onRemoved: (id: number) => void;
}) {
  const [rescanPending, setRescanPending] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const failed = repo.last_scan_status === 'failed';
  const needsReconnect = failed && importNeedsReconnect(repo.scan_error);

  const onRescan = () =>
    runRescan({
      id: repo.id,
      pending: rescanPending,
      rescan: rescanTrackedRepo,
      setPending: setRescanPending,
      setError: setRescanError,
      // The trigger returns the still-settled record; flip it in-flight so the
      // existing poll takes over and the spinner shows at once.
      onRescanned: (fresh) => onRescanned({ ...fresh, last_scan_status: 'running' }),
    });

  const onConfirmDelete = () =>
    runDelete({
      id: repo.id,
      pending: deletePending,
      remove: deleteTrackedRepo,
      setPending: setDeletePending,
      setError: setDeleteError,
      onRemoved,
    });

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onRescan} disabled={rescanPending} className={ACTION_CLASS}>
          {rescanPending ? 'Re-scanning…' : failed ? 'Retry scan' : 'Re-scan'}
        </button>

        {needsReconnect ? (
          <Link href="/settings" className={LINK_CLASS}>
            Reconnect GitHub
          </Link>
        ) : null}

        <div className="ml-auto">
          {confirmingDelete ? (
            <span className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              Remove tracking?
              <button type="button" onClick={onConfirmDelete} disabled={deletePending} className={DANGER_CLASS}>
                {deletePending ? 'Removing…' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deletePending}
                className={ACTION_CLASS}
              >
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)} className={DANGER_CLASS}>
              Delete
            </button>
          )}
        </div>
      </div>

      {confirmingDelete && !deleteError ? (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Its documents stay in the project — only tracking is removed.
        </p>
      ) : null}
      {rescanError ? (
        <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-400">
          {rescanError}
        </p>
      ) : null}
      {deleteError ? (
        <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-400">
          {deleteError}
        </p>
      ) : null}
    </div>
  );
}

function ScanReportSummary({ report }: { report: ScanReport }) {
  const { import_queued, resync_queued, unchanged, missing, failed } = report.counts;

  return (
    <div className="mt-2">
      {isZeroMatch(report) ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-medium text-amber-700 dark:text-amber-400">0 files matched</span>
          {' — adjust the pattern.'}
          {report.stale_takeover ? (
            <span className="text-amber-700 dark:text-amber-400"> · recovered a stalled scan</span>
          ) : null}
        </p>
      ) : isUpToDate(report) ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-medium text-emerald-700 dark:text-emerald-400">Already up to date</span>
          {unchanged > 0 ? ` · ${unchanged} file${unchanged === 1 ? '' : 's'} unchanged` : null}
          {report.stale_takeover ? (
            <span className="text-amber-700 dark:text-amber-400"> · recovered a stalled scan</span>
          ) : null}
        </p>
      ) : (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-medium text-emerald-700 dark:text-emerald-400">{import_queued} queued</span>
          {resync_queued > 0 ? (
            <span className="text-emerald-700 dark:text-emerald-400">{' · '}{resync_queued} re-synced</span>
          ) : null}
          {' · '}
          {unchanged} unchanged
          {missing > 0 ? (
            <span className="text-amber-700 dark:text-amber-400">{' · '}{missing} missing</span>
          ) : null}
          {failed > 0 ? (
            <span className="text-rose-700 dark:text-rose-400">{' · '}{failed} failed</span>
          ) : null}
          {report.stale_takeover ? (
            <span className="text-amber-700 dark:text-amber-400"> · recovered a stalled scan</span>
          ) : null}
        </p>
      )}

      {report.files.length > 0 ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
            {report.matched} file{report.matched === 1 ? '' : 's'} scanned
            {missing > 0 ? `, ${missing} missing` : ''}
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

const BADGE_BASE = PILL_BASE;

function OutcomeBadge({ outcome, reason }: { outcome: ScanOutcome; reason: string | null }) {
  if (outcome === 'import_queued') {
    return (
      <span className={`${BADGE_BASE} bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300`}>
        Queued
      </span>
    );
  }

  if (outcome === 'resync_queued') {
    return (
      <span className={`${BADGE_BASE} bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300`}>
        Re-synced
      </span>
    );
  }

  if (outcome === 'missing') {
    return (
      <span className={`${BADGE_BASE} bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300`}>
        Missing
      </span>
    );
  }

  if (outcome === 'failed') {
    return (
      <span
        title={reason ?? undefined}
        className={`${BADGE_BASE} bg-rose-100 text-rose-800 dark:bg-rose-400/10 dark:text-rose-300`}
      >
        Failed
      </span>
    );
  }

  return (
    <span className={`${BADGE_BASE} bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-400`}>
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
    key: id,
  });

  return null;
}
