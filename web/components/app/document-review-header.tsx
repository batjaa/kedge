import Link from 'next/link';
import { CheckCircle2, MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { MetaChip } from './meta-chip';
import { cn } from '@/lib/cn';
import type { Approval, LifecycleStatus } from '@/lib/document-types';
import { relativeTime } from '@/lib/relative-time';

export function DocumentReviewHeader({
  title,
  surfaceLabel,
  lifecycleStatus,
  sourceUrl,
  versionLabel,
  syncedAt,
  approvals = [],
  openThreadCount,
  backHref,
  backLabel,
  syncError,
  actions,
}: {
  title: string;
  surfaceLabel: string;
  lifecycleStatus?: LifecycleStatus | null;
  sourceUrl?: string | null;
  versionLabel?: string | null;
  syncedAt?: string | null;
  approvals?: Approval[];
  openThreadCount: number;
  backHref?: string | null;
  backLabel?: string | null;
  syncError?: string | null;
  actions?: ReactNode;
}) {
  return (
    <header className="sticky top-14 z-30 -mx-6 border-b border-zinc-900/10 bg-white/90 px-6 py-3 backdrop-blur dark:border-white/10 dark:bg-zinc-900/90">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-3">
        <div className="min-w-0 flex-1">
          {backHref && backLabel ? (
            <Link
              href={backHref}
              className="mb-1 inline-flex text-sm text-emerald-600 hover:text-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400"
            >
              {backLabel}
            </Link>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {versionLabel ? <MetaChip>{versionLabel}</MetaChip> : null}
            {lifecycleStatus ? <StatusChip status={lifecycleStatus} /> : null}
            <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{surfaceLabel}</span>
            {syncedAt ? (
              <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                synced {relativeTime(syncedAt)}
              </span>
            ) : null}
          </div>
          <h1 className="mt-1 truncate text-xl font-semibold text-zinc-900 dark:text-white sm:text-2xl">
            {title}
          </h1>
          {sourceUrl ? (
            <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-500">
              {sourceUrl}
            </p>
          ) : null}
          {syncError ? (
            <p className="mt-2 text-xs font-medium text-rose-700 dark:text-rose-300">
              {syncError}
            </p>
          ) : null}
          {approvals.length > 0 ? (
            <ul className="mt-2 flex flex-wrap items-center gap-1.5">
              {approvals.map((approval) => (
                <ApprovalRosterItem
                  key={approval.id}
                  approval={approval}
                  currentVersionLabel={versionLabel}
                />
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions}
          <div className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-zinc-700 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
            <MessageSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>{openThreadCount} open</span>
          </div>
        </div>
      </div>
    </header>
  );
}

function ApprovalRosterItem({
  approval,
  currentVersionLabel,
}: {
  approval: Approval;
  currentVersionLabel?: string | null;
}) {
  const label = approval.stale && currentVersionLabel
    ? `approved ${approval.version_label} · current ${currentVersionLabel}`
    : `approved ${approval.version_label}`;

  return (
    <li
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-2 py-1 text-xs ring-1 ring-inset',
        approval.stale
          ? 'bg-amber-400/10 text-amber-700 ring-amber-500/25 dark:text-amber-300 dark:ring-amber-400/25'
          : 'bg-emerald-400/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300 dark:ring-emerald-400/25',
      )}
      title={label}
    >
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate font-medium text-zinc-800 dark:text-zinc-100">
        {approval.user.name ?? 'Reviewer'}
      </span>
      <span className="shrink-0 font-mono text-[10px]">
        {label}
      </span>
    </li>
  );
}

function StatusChip({ status }: { status: LifecycleStatus }) {
  const active = status === 'in_review';

  return (
    <span
      className={cn(
        'rounded-lg px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ring-1 ring-inset',
        active
          ? 'bg-amber-400/10 text-amber-600 ring-amber-500/30 dark:text-amber-400'
          : 'text-zinc-500 ring-zinc-300 dark:text-zinc-400 dark:ring-zinc-700',
      )}
    >
      {status.replace('_', ' ')}
    </span>
  );
}
