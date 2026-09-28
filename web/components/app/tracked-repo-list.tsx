'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { deleteTrackedRepo, readTrackedRepo, rescanTrackedRepo } from '@/lib/tracked-repos-client';
import { runDelete, runRescan } from '@/lib/tracked-repo-actions';
import {
  isScanInFlight,
  isDocumentProcessing,
  isReportOperationCurrent,
  isReportOperationSuccessful,
  isUpToDate,
  isZeroMatch,
  needsProcessingRefresh,
  scanSettled,
  type ScanOutcome,
  type TrackedDocumentState,
  type ScanReport,
  type TrackedRepo,
} from '@/lib/tracked-repo-scan';
import { importNeedsReconnect } from '@/lib/import-retry';
import { POLL_INTERVAL_MS, usePollUntilSettled } from '@/lib/use-poll-until-settled';
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
//
// i18n (M3.9): chrome + report fragments from the tracked-repos catalog (ICU
// plurals where counts inflect); outcome badges ride the 13A chip glossary.
// Repo URLs, refs, patterns, file paths, and API scan-error prose are DATA.

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
  onProcessingUpdated = () => {},
}: {
  repos: TrackedRepo[];
  onScanned: (repo: TrackedRepo) => void;
  onRescanned: (repo: TrackedRepo) => void;
  onRemoved: (id: number) => void;
  onProcessingUpdated?: (repo: TrackedRepo) => void;
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
          onProcessingUpdated={onProcessingUpdated}
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
  onProcessingUpdated = () => {},
}: {
  repo: TrackedRepo;
  onScanned: (repo: TrackedRepo) => void;
  onRescanned: (repo: TrackedRepo) => void;
  onRemoved: (id: number) => void;
  onProcessingUpdated?: (repo: TrackedRepo) => void;
}) {
  const t = useTranslations('tracked-repos');
  const inFlight = isScanInFlight(repo.last_scan_status);
  const report = repo.last_scan_report;

  return (
    <li className="rounded-xl bg-zinc-50 p-3.5 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/[.02] dark:ring-white/10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <code className="font-mono text-sm font-medium text-zinc-900 dark:text-white">
          {repoShortName(repo.repo_url)}
        </code>
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {repo.ref ?? report?.ref ?? t('row.defaultRef')} · {repo.path_pattern}
        </span>
      </div>

      {inFlight ? (
        <p role="status" className="mt-2 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <span
            aria-hidden="true"
            className="size-3.5 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-500"
          />
          {t('row.scanning')}
        </p>
      ) : repo.last_scan_status === 'failed' ? (
        <p role="alert" className={ERROR_CLASS}>
          {repo.scan_error ?? t('row.scanFailedFallback')}
        </p>
      ) : report ? (
        <ScanReportSummary repo={repo} report={report} />
      ) : (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('row.notScanned')}</p>
      )}

      {inFlight ? (
        <ScanPoller id={repo.id} onScanned={onScanned} />
      ) : (
        <>
          <ProcessingPoller repo={repo} onUpdated={onProcessingUpdated} />
          <RowActions repo={repo} onRescanned={onRescanned} onRemoved={onRemoved} />
        </>
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
  const t = useTranslations('tracked-repos');
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
          {rescanPending ? t('row.rescanning') : failed ? t('row.retryScan') : t('row.rescan')}
        </button>

        {needsReconnect ? (
          <Link href="/settings" className={LINK_CLASS}>
            {t('row.reconnect')}
          </Link>
        ) : null}

        <div className="ml-auto">
          {confirmingDelete ? (
            <span className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              {t('row.confirmRemove')}
              <button type="button" onClick={onConfirmDelete} disabled={deletePending} className={DANGER_CLASS}>
                {deletePending ? t('row.removing') : t('row.delete')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deletePending}
                className={ACTION_CLASS}
              >
                {t('row.cancel')}
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)} className={DANGER_CLASS}>
              {t('row.delete')}
            </button>
          )}
        </div>
      </div>

      {confirmingDelete && !deleteError ? (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {t('row.removeHint')}
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

function ScanReportSummary({ repo, report }: { repo: TrackedRepo; report: ScanReport }) {
  const t = useTranslations('tracked-repos');
  const { import_queued, resync_queued, unchanged, missing, failed } = report.counts;
  const states = new Map((repo.document_states ?? []).map((state) => [state.id, state]));
  const affected = report.files.filter((file) => file.outcome === 'import_queued' || file.outcome === 'resync_queued');
  const checking = needsProcessingRefresh(repo) && repo.document_states === undefined;
  const processing = affected.filter((file) => isReportOperationCurrent(file, states.get(file.document_id ?? -1))
    && isDocumentProcessing(states.get(file.document_id ?? -1)));
  const takingLonger = processing.some((file) => {
    const state = states.get(file.document_id ?? -1);
    return state?.sync_started_at !== null
      && state?.sync_started_at !== undefined
      && Date.now() - Date.parse(state.sync_started_at) > 30_000;
  });
  const allReady = !checking && affected.length > 0
    && !needsProcessingRefresh(repo)
    && affected.every((file) => isReportOperationSuccessful(file, states.get(file.document_id ?? -1)));

  return (
    <div className="mt-2">
      <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
        {t('report.lastScan', { date: new Date(report.finished_at) })}
        {' · '}
        {t('report.discovery', { new: import_queued, changed: resync_queued, unchanged })}
      </p>

      {isZeroMatch(report) ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-medium text-amber-700 dark:text-amber-400">
            {t('report.zeroMatched')}
          </span>
          {t('report.adjustPattern')}
          {report.stale_takeover ? (
            <span className="text-amber-700 dark:text-amber-400">{t('report.staleTakeover')}</span>
          ) : null}
        </p>
      ) : isUpToDate(report) ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-medium text-emerald-700 dark:text-emerald-400">
            {t('report.upToDate')}
          </span>
          {unchanged > 0 ? t('report.filesUnchanged', { count: unchanged }) : null}
          {report.stale_takeover ? (
            <span className="text-amber-700 dark:text-amber-400">{t('report.staleTakeover')}</span>
          ) : null}
        </p>
      ) : (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {checking ? t('report.checkingStatus') : processing.length > 0 ? (
            <span className="font-medium text-amber-700 dark:text-amber-400">{takingLonger ? t('report.takingLonger') : t('report.processing')}</span>
          ) : allReady ? (
            <span className="font-medium text-emerald-700 dark:text-emerald-400">{t('report.allReady')}</span>
          ) : null}
          {missing > 0 ? (
            <span className="text-amber-700 dark:text-amber-400">
              {t('report.missing', { count: missing })}
            </span>
          ) : null}
          {failed > 0 ? (
            <span className="text-rose-700 dark:text-rose-400">
              {t('report.failed', { count: failed })}
            </span>
          ) : null}
          {report.stale_takeover ? (
            <span className="text-amber-700 dark:text-amber-400">{t('report.staleTakeover')}</span>
          ) : null}
        </p>
      )}

      {report.files.length > 0 ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
            {t('report.scanned', { count: report.matched })}
            {missing > 0 ? t('report.scannedMissing', { count: missing }) : ''}
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
                <OutcomeBadge outcome={file.outcome} reason={file.reason} state={file.document_id === null ? undefined : states.get(file.document_id)} operationGeneration={file.operation_generation} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

const BADGE_BASE = PILL_BASE;

// One per-file outcome pill — the 13A chip glossary's scan labels, keyed by the
// wire outcome so an unknown value falls back to the "unchanged" neutral rather
// than crashing the report (the hard rendering rule).
function OutcomeBadge({ outcome, reason, state, operationGeneration }: { outcome: ScanOutcome; reason: string | null; state?: TrackedDocumentState; operationGeneration?: number | null }) {
  const chips = useTranslations('chips');
  const operationCurrent = typeof operationGeneration === 'number' && state?.sync_generation === operationGeneration;

  if (outcome === 'import_queued') {
    if (operationCurrent && state?.status === 'failed') return <StatusBadge tone="rose" label={chips('scan.import_failed')} title={state.sync_error} />;
    if (operationCurrent && isDocumentProcessing(state)) return <StatusBadge tone="amber" label={chips('scan.importing')} />;
    if (operationCurrent && state) return <StatusBadge tone="emerald" label={chips('scan.ready')} />;
    if (state) return <StatusBadge tone="zinc" label={chips('scan.unconfirmed')} />;
    return (
      <span className={`${BADGE_BASE} bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300`}>
        {chips('scan.new_file')}
      </span>
    );
  }

  if (outcome === 'resync_queued') {
    if (operationCurrent && state?.last_sync_status === 'failed') return <StatusBadge tone="rose" label={chips('scan.update_failed')} title={state.sync_error} />;
    if (operationCurrent && isDocumentProcessing(state)) return <StatusBadge tone="amber" label={chips('scan.updating')} />;
    if (operationCurrent && state) return <StatusBadge tone="emerald" label={chips('scan.ready')} />;
    if (state) return <StatusBadge tone="zinc" label={chips('scan.unconfirmed')} />;
    return (
      <span className={`${BADGE_BASE} bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300`}>
        {chips('scan.changed')}
      </span>
    );
  }

  if (outcome === 'missing') {
    return (
      <span className={`${BADGE_BASE} bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300`}>
        {chips('scan.missing')}
      </span>
    );
  }

  if (outcome === 'failed') {
    return (
      <span
        title={reason ?? undefined}
        className={`${BADGE_BASE} bg-rose-100 text-rose-800 dark:bg-rose-400/10 dark:text-rose-300`}
      >
        {chips('scan.failed')}
      </span>
    );
  }

  return (
    <span className={`${BADGE_BASE} bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-400`}>
      {chips('scan.unchanged')}
    </span>
  );
}

function StatusBadge({ tone, label, title }: { tone: 'emerald' | 'amber' | 'rose' | 'zinc'; label: string; title?: string | null }) {
  const colors = {
    emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300',
    rose: 'bg-rose-100 text-rose-800 dark:bg-rose-400/10 dark:text-rose-300',
    zinc: 'bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-300',
  };
  return <span title={title ?? undefined} className={`${BADGE_BASE} ${colors[tone]}`}>{label}</span>;
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

/**
 * One bounded, batched read for every affected path in a report. It starts on
 * mount too, so opening an old report resolves current state rather than trusting
 * a historic dispatch result. Sequence/cancel guards make late reads harmless.
 */
function ProcessingPoller({ repo, onUpdated }: { repo: TrackedRepo; onUpdated: (repo: TrackedRepo) => void }) {
  const t = useTranslations('tracked-repos');
  const [unavailable, setUnavailable] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!needsProcessingRefresh(repo)) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const fresh = await readTrackedRepo(repo.id);
      if (cancelled) return;
      if (fresh === null) {
        setUnavailable(true);
      } else {
        setUnavailable(false);
        setRefreshRequired(false);
        onUpdated(fresh);
        if (!needsProcessingRefresh(fresh)) return;
      }
      attempts += 1;
      if (attempts >= 20) {
        setRefreshRequired(true);
        return;
      }
      timer = setTimeout(refresh, POLL_INTERVAL_MS);
    };
    timer = setTimeout(refresh, 0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [repo.id, repo.last_scan_report?.finished_at, onUpdated, refreshKey]);

  if (!unavailable && !refreshRequired) return null;
  const retry = () => {
    setUnavailable(false);
    setRefreshRequired(false);
    setRefreshKey((value) => value + 1);
  };
  return (
    <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-400">
      {unavailable ? t('report.statusUnavailable') : t('report.takingLonger')}{' '}
      <button type="button" className="underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500" onClick={retry}>
        {t('report.refresh')}
      </button>
    </p>
  );
}
