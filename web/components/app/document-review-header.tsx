import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { MetaChip } from './meta-chip';
import { StatusChip } from './status-chip';
import { ApprovalRoster } from './approval-roster';
import type { Approval, LifecycleStatus } from '@/lib/document-types';
import { formatRelativeTime } from '@/lib/intl-time';

export function DocumentReviewHeader({
  title,
  surfaceLabel,
  lifecycleStatus,
  sourceUrl,
  versionLabel,
  currentVersionLabel = versionLabel,
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
  currentVersionLabel?: string | null;
  syncedAt?: string | null;
  approvals?: Approval[];
  openThreadCount: number;
  backHref?: string | null;
  backLabel?: string | null;
  syncError?: string | null;
  actions?: ReactNode;
}) {
  const t = useTranslations('review');
  const locale = useLocale();

  return (
    <header className="sticky top-14 z-30 border-b border-zinc-900/10 bg-white/90 px-6 py-3 backdrop-blur dark:border-white/10 dark:bg-zinc-900/90">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
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
                {t('header.synced', { when: formatRelativeTime(syncedAt, locale) })}
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
          <ApprovalRoster approvals={approvals} currentVersionLabel={currentVersionLabel} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions}
          <div className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-zinc-700 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
            <MessageSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>{t('header.openCount', { count: openThreadCount })}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
