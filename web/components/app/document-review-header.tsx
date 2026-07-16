import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { MetaChip } from './meta-chip';
import { cn } from '@/lib/cn';
import type { LifecycleStatus } from '@/lib/document-types';
import { relativeTime } from '@/lib/relative-time';

export function DocumentReviewHeader({
  title,
  surfaceLabel,
  lifecycleStatus,
  sourceUrl,
  versionLabel,
  syncedAt,
  openThreadCount,
  backHref,
  backLabel,
}: {
  title: string;
  surfaceLabel: string;
  lifecycleStatus?: LifecycleStatus | null;
  sourceUrl?: string | null;
  versionLabel?: string | null;
  syncedAt?: string | null;
  openThreadCount: number;
  backHref?: string | null;
  backLabel?: string | null;
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
        </div>
        <div className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-zinc-700 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
          <MessageSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <span>{openThreadCount} open</span>
        </div>
      </div>
    </header>
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
