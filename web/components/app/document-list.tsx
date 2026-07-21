import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { MetaChip } from './meta-chip';
import { StatePanel } from './state-panel';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import type { DocumentListItem, DocumentListPage, LifecycleStatus } from '@/lib/document-types';

// The workspace document list on the authenticated home (SPEC 11). A pure,
// server-rendered panel fed page 1 by the home server component — it owns the
// three read outcomes: rows, the empty state, and the degraded "API
// unreachable" state (the home never 500s over the list). Live import progress,
// prepend-on-submit, inline retry, and "Load more" are later tickets (#85–#87);
// this is the static list that grounds them. DESIGN.md panel idiom: divide-y
// rows in a rounded-2xl hairline card, mono chips, status hues in chips only.
export function DocumentList({ page }: { page: DocumentListPage | null }) {
  return (
    <section className="mt-10" aria-labelledby="documents-heading">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2
          id="documents-heading"
          className="text-base font-semibold text-zinc-900 dark:text-white"
        >
          Your documents
        </h2>
        {page && page.data.length > 0 ? <MetaChip>{page.meta.total}</MetaChip> : null}
      </div>

      {page === null ? (
        // Degraded (3A): the API is unreachable or 404s mid-rollout. The import
        // box above keeps working; only this area falls back to the panel idiom.
        <StatePanel
          title="Couldn't load your documents"
          body="The API is unreachable right now. Your import box above still works — refresh in a moment."
        />
      ) : page.data.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-4 overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
          <ul role="list" className="divide-y divide-zinc-900/5 dark:divide-white/10">
            {page.data.map((item) => (
              <DocumentRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="mt-4 rounded-2xl bg-white p-8 text-center ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
        No documents yet
      </h3>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        Import a spec or RFC with the box above and it lands here — every document
        in your workspace, newest first.
      </p>
    </div>
  );
}

function DocumentRow({ item }: { item: DocumentListItem }) {
  return (
    <li>
      <Link
        href={`/documents/${item.id}`}
        className="flex items-center gap-4 px-4 py-4 transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 dark:hover:bg-white/[.02] sm:px-6"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <LifecycleChip status={item.lifecycle_status} />
            <SyncState item={item} />
          </div>
          <p className="mt-1 truncate text-sm font-medium text-zinc-900 dark:text-white">
            {item.title}
          </p>
        </div>
        <OpenThreads count={item.open_threads_count} />
      </Link>
    </li>
  );
}

// Reuses the review header's lifecycle chip: amber only for in-review, neutral
// zinc otherwise — status hues live in chips, never in prose (DESIGN.md).
function LifecycleChip({ status }: { status: LifecycleStatus }) {
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

// Last-sync state + relative time. A colored dot carries the hue (emerald
// ready, amber importing, rose failed); the label stays quiet.
function SyncState({ item }: { item: DocumentListItem }) {
  if (item.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">
        <Dot className="bg-rose-500" />
        Import failed
      </span>
    );
  }

  if (item.status === 'importing') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
        <Dot className="bg-amber-500" />
        Importing…
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
      <Dot className="bg-emerald-500" />
      {item.synced_at ? `synced ${relativeTime(item.synced_at)}` : 'ready'}
    </span>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={cn('h-1.5 w-1.5 rounded-full', className)} aria-hidden="true" />;
}

function OpenThreads({ count }: { count: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
      <MessageSquare className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      {count}
      <span className="sr-only">open threads</span>
    </span>
  );
}
