'use client';

import { type ChangeEvent, useState } from 'react';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { MetaChip } from './meta-chip';
import { StatePanel } from './state-panel';
import { StatusChip } from './status-chip';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { readDocument } from '@/lib/documents-client';
import { assignDocumentProject } from '@/lib/projects-client';
import { runProjectAssign } from '@/lib/assign-project';
import { shouldPoll } from '@/lib/document-list-live';
import { groupDocumentsByProject, hasNamedGroups } from '@/lib/document-groups';
import { usePollUntilSettled } from '@/lib/use-poll-until-settled';
import { useImportRetry } from '@/lib/import-retry';
import type {
  Document,
  DocumentLifecycleFilter,
  DocumentListItem,
  Project,
  ProjectRef,
  WorkspaceSummary,
} from '@/lib/document-types';

// The workspace document list on the authenticated home (SPEC 11) and, re-scoped
// with `grouped={false}`, a project page (M3.6). The client island owns the row
// state; this renders it live: prepend-on-submit rows arrive importing and each
// settles in place to ready/failed (2A), only importing rows poll and they stop
// the moment they settle. It owns the three read outcomes — rows, the empty
// state, and the degraded "API unreachable" state (the list never 500s) — plus a
// polite live region that announces each settle (10A). At M3.6 it also groups by
// project (headers alphabetical, Unfiled last — 14A) and carries a per-row
// project chip that doubles as the assignment selector. DESIGN.md panel idiom:
// divide-y rows in a rounded-2xl hairline card, mono chips, status hues in chips
// only; the title stays a real link.
export function DocumentList({
  items,
  total,
  hasMore = false,
  loadingMore = false,
  onLoadMore = () => {},
  degraded,
  announcement,
  onSettled,
  onRetried,
  projects = [],
  onAssigned = () => {},
  grouped = false,
  filter,
  onSelectFilter,
  summary,
  heading = 'Your documents',
  className = 'mt-10',
  emptyTitle = 'No documents yet',
  emptyBody = 'Import a spec or RFC with the box above and it lands here — every document in your workspace, newest first.',
}: {
  items: DocumentListItem[];
  total: number;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  degraded: boolean;
  announcement: string;
  onSettled: (doc: Document) => void;
  onRetried: (id: number) => void;
  /** The workspace's projects — populate the row chip selector; empty hides it. */
  projects?: Project[];
  /** A row was re-filed (or cleared): the island updates/regroups/removes it. */
  onAssigned?: (doc: Document) => void;
  /** Render project group headers (home). Off on a single-project page. */
  grouped?: boolean;
  /** The active lifecycle chip (5A). Chips render only when onSelectFilter is set. */
  filter?: DocumentLifecycleFilter;
  /** Select a lifecycle chip — the dashboard only (#103); omit to hide chips. */
  onSelectFilter?: (filter: DocumentLifecycleFilter) => void;
  /** Chip counts (SPEC §16, M3.7); null keeps the chips but drops the counts (A1). */
  summary?: WorkspaceSummary | null;
  heading?: string;
  /** The root section's spacing — default `mt-10`; the dashboard grid (#104)
   *  zeroes it so the list aligns with the projects rail beside it. */
  className?: string;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  // Degraded wins only while we have nothing to show; a successful import gives
  // us a real row, so the StatePanel yields to it rather than hiding it.
  const showDegraded = degraded && items.length === 0;

  // Group only when asked (home); a project page is one implicit group. Headers
  // appear only when a project is actually assigned — a workspace with none reads
  // exactly as it did before projects existed (single implicit group, 14A).
  const groups = grouped
    ? groupDocumentsByProject(items)
    : [{ project: null as ProjectRef | null, items }];
  const showHeaders = grouped && hasNamedGroups(groups);

  // The lifecycle filter chips (SPEC §16, M3.7; #103) — dashboard only (a project
  // page passes no onSelectFilter). Rendered once there's something to filter so a
  // brand-new workspace's empty state stays clean; an active non-All chip keeps
  // them visible even when its page is empty, so the way back is always there.
  const showChips = !!onSelectFilter && !showDegraded && (items.length > 0 || filter !== 'all');

  return (
    <section className={className} aria-labelledby="documents-heading">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2
          id="documents-heading"
          className="text-base font-semibold text-zinc-900 dark:text-white"
        >
          {heading}
        </h2>
        {!showDegraded && items.length > 0 ? <MetaChip>{total}</MetaChip> : null}
        {showChips && onSelectFilter ? (
          <FilterChips
            className="ml-auto"
            active={filter ?? 'all'}
            summary={summary ?? null}
            onSelect={onSelectFilter}
          />
        ) : null}
      </div>

      {/* Settle announcements for screen readers (10A): a single polite region
          whose text is swapped as each import lands, never removed from the DOM
          so assistive tech keeps watching it. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {showDegraded ? (
        // Degraded (3A): the API is unreachable or 404s mid-rollout. The import
        // box above keeps working; only this area falls back to the panel idiom.
        <StatePanel
          title="Couldn't load your documents"
          body="The API is unreachable right now. Your import box above still works — refresh in a moment."
        />
      ) : items.length === 0 ? (
        <EmptyState title={emptyTitle} body={emptyBody} />
      ) : (
        <>
          {/* Degraded, but a live prepend gave us rows to show: the StatePanel
              yields to them, yet the failure signal must not vanish (a 30-doc
              workspace could otherwise present as this session's imports alone).
              A slim inline warning keeps it visible above the rows (C2). */}
          {degraded ? <DegradedNotice /> : null}
          {showHeaders ? (
            groups.map((group) => (
              <div key={group.project?.id ?? 'unfiled'}>
                <GroupHeader project={group.project} count={group.items.length} />
                <RowCard
                  items={group.items}
                  projects={projects}
                  onSettled={onSettled}
                  onRetried={onRetried}
                  onAssigned={onAssigned}
                />
              </div>
            ))
          ) : (
            <RowCard
              className="mt-4"
              items={items}
              projects={projects}
              onSettled={onSettled}
              onRetried={onRetried}
              onAssigned={onAssigned}
            />
          )}
        </>
      )}

      {/* Appends the next page in order and disappears when the paginator has no further pages (#86). */}
      {!showDegraded && hasMore ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-900/10 transition hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

// The dashboard lifecycle filter chips (SPEC §16, M3.7; #103; docs/designs/
// app-dashboard.html). One chip per state the mockup surfaces — All, the three
// editorial lifecycles, and the needs-attention composite — each carrying its
// count from the workspace summary (7A: chip count == the total that state
// narrows the list to). The active chip is the solid pill; the rest are hairline
// outlines (the mockup's recipe). A null summary (A1) keeps the chips and their
// filtering but drops the counts. Kept inside the list region so the rail+table
// wrap (#104) stays clean. Selecting a chip refetches server-side (the hook),
// never a client cull — so it is correct across pagination.
const LIFECYCLE_CHIPS: ReadonlyArray<{
  value: DocumentLifecycleFilter;
  label: string;
  count: (summary: WorkspaceSummary) => number;
}> = [
  { value: 'all', label: 'All', count: (s) => s.documents.total },
  { value: 'in_review', label: 'In review', count: (s) => s.documents.lifecycle.in_review },
  { value: 'approved', label: 'Approved', count: (s) => s.documents.lifecycle.approved },
  { value: 'draft', label: 'Draft', count: (s) => s.documents.lifecycle.draft },
  { value: 'needs_attention', label: 'Needs attention', count: (s) => s.documents.needs_attention },
];

function FilterChips({
  active,
  summary,
  onSelect,
  className,
}: {
  active: DocumentLifecycleFilter;
  summary: WorkspaceSummary | null;
  onSelect: (filter: DocumentLifecycleFilter) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Filter documents by lifecycle"
      className={cn('flex flex-wrap items-center gap-1.5 text-xs', className)}
    >
      {LIFECYCLE_CHIPS.map((chip) => {
        const isActive = chip.value === active;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(chip.value)}
            className={cn(
              'rounded-full px-2.5 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
              isActive
                ? 'bg-zinc-900 font-medium text-white dark:bg-white/10 dark:text-zinc-200'
                : 'text-zinc-500 ring-1 ring-inset ring-zinc-900/10 hover:bg-white dark:text-zinc-400 dark:ring-white/10 dark:hover:bg-white/5',
            )}
          >
            {chip.label}
            {summary ? (
              <span className="ml-1 font-mono tabular-nums">· {chip.count(summary)}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// One project's (or Unfiled's) group header (14A): the project name links to its
// page; Unfiled is plain, always last. The count rides the mono chip idiom.
function GroupHeader({ project, count }: { project: ProjectRef | null; count: number }) {
  return (
    <div className="mb-3 mt-8 flex flex-wrap items-center gap-x-3 gap-y-1">
      {project ? (
        <Link
          href={`/projects/${project.id}`}
          className="text-sm font-semibold text-zinc-900 hover:text-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-white dark:hover:text-emerald-400"
        >
          {project.name}
        </Link>
      ) : (
        <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Unfiled</h3>
      )}
      <MetaChip>{count}</MetaChip>
    </div>
  );
}

// The rounded-2xl hairline card holding one group's divide-y rows (DESIGN.md).
function RowCard({
  items,
  projects,
  onSettled,
  onRetried,
  onAssigned,
  className,
}: {
  items: DocumentListItem[];
  projects: Project[];
  onSettled: (doc: Document) => void;
  onRetried: (id: number) => void;
  onAssigned: (doc: Document) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10',
        className,
      )}
    >
      <ul role="list" className="divide-y divide-zinc-900/5 dark:divide-white/10">
        {items.map((item) => (
          <DocumentRow
            key={item.id}
            item={item}
            projects={projects}
            onSettled={onSettled}
            onRetried={onRetried}
            onAssigned={onAssigned}
          />
        ))}
      </ul>
    </div>
  );
}

// The degraded-but-not-empty signal (C2): a slim amber warning shown above the
// rows when the server-side list read failed yet this session's live prepends
// give us something to render — so the failure never silently disappears.
function DegradedNotice() {
  return (
    <div
      role="status"
      className="mt-4 rounded-xl bg-amber-500/5 px-4 py-2.5 text-xs leading-5 text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300 dark:ring-amber-400/20"
    >
      Couldn&apos;t load your documents — showing only this session&apos;s imports. Refresh to see everything.
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4 rounded-2xl bg-white p-8 text-center ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {body}
      </p>
    </div>
  );
}

function DocumentRow({
  item,
  projects,
  onSettled,
  onRetried,
  onAssigned,
}: {
  item: DocumentListItem;
  projects: Project[];
  onSettled: (doc: Document) => void;
  onRetried: (id: number) => void;
  onAssigned: (doc: Document) => void;
}) {
  return (
    <li>
      {/* The row is a flex container, not one big anchor: the title links to the
          document, while the project selector on the right is interactive and so
          must live OUTSIDE the anchor (no nested interactives). */}
      <div className="flex items-center gap-3 px-4 py-4 transition hover:bg-zinc-50 dark:hover:bg-white/[.02] sm:px-6">
        <Link
          href={`/documents/${item.id}`}
          className="min-w-0 flex-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusChip status={item.lifecycle_status} />
            <SyncState item={item} />
          </div>
          <p className="mt-1 truncate text-sm font-medium text-zinc-900 dark:text-white">
            {item.title}
          </p>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          {projects.length > 0 ? (
            <RowProjectChip item={item} projects={projects} onAssigned={onAssigned} />
          ) : null}
          <OpenThreads count={item.open_threads_count} />
        </div>
      </div>
      {/* Recovery lives outside the row link (an anchor can't wrap a button):
          a failed row shows its error and the shared retry affordance inline (7A),
          so recovery starts where the failure is seen. */}
      {item.status === 'failed' ? (
        <RowRetry item={item} onRetried={onRetried} />
      ) : null}
      {/* Only importing rows mount a poller, so an idle list issues zero
          background requests (2A); the poller unmounts — and stops — the moment
          the row settles out of `importing`. A retry flips the row back to
          `importing`, which re-mounts this poller so the row settles live. The
          tested `shouldPoll` predicate owns this decision (no inlined status). */}
      {shouldPoll(item) ? (
        <RowPoller id={item.id} onSettled={onSettled} />
      ) : null}
    </li>
  );
}

// The per-row project chip AND assignment selector (M3.6): shows the document's
// project (or Unfiled) as its value — the reserved M3.5 chip slot filled — and
// re-files it on change. Rendered as a compact pill mirroring the header's
// lifecycle selector; optimistic hand-off to the island via onAssigned, which
// owns regrouping (home) or removal (a project page it was moved out of).
function RowProjectChip({
  item,
  projects,
  onAssigned,
}: {
  item: DocumentListItem;
  projects: Project[];
  onAssigned: (doc: Document) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentId = item.project?.id ?? null;

  function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const raw = event.target.value;
    // The move failure surfaces (role=alert, like RowRetry's) and leaves `item`
    // unchanged, so the controlled <select> snaps back to the real project. The
    // pure core owns the try/finally so a rejected fetch can't wedge pending.
    void runProjectAssign({
      documentId: item.id,
      nextId: raw === '' ? null : Number(raw),
      currentId,
      pending,
      assign: assignDocumentProject,
      setPending,
      setError,
      onAssigned,
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        aria-label={`Project for ${item.title}`}
        value={currentId === null ? '' : String(currentId)}
        disabled={pending}
        onChange={onChange}
        className="max-w-[9rem] truncate rounded-full bg-zinc-100 px-2.5 py-1 font-mono text-[11px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-900/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10"
      >
        <option value="">Unfiled</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      {error ? (
        <span
          role="alert"
          className="max-w-[9rem] text-right text-[10px] leading-tight text-rose-600 dark:text-rose-400"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

// The failed row's inline recovery (7A) — the documents-list's consumer of the
// shared affordance the doc page's ImportFailed also uses, so copy and behaviour
// (pending guard, retry-error copy, dead-PAT branch) match exactly. Compact by
// design (a list row, not the doc-page panel): the import error and its actions.
// Retry is ALWAYS offered (it flips the row back to `importing` via onRetried so
// the RowPoller resumes and settles it in place); a dead PAT ADDITIONALLY shows a
// "reconnect in Settings" link — additive, exactly like ImportFailed, so a user
// who has since reconnected is never left with only the Settings link and no way
// to re-run the import from the row (SPEC §19). The re-settle rides the list's
// existing polite live region: a recovery to ready reads as a fresh "Import
// ready: {title}" announcement — no new a11y machinery.
function RowRetry({
  item,
  onRetried,
}: {
  item: DocumentListItem;
  onRetried: (id: number) => void;
}) {
  const { needsReconnect, pending, retryError, onRetry } = useImportRetry({
    id: item.id,
    error: item.sync_error,
    onRetried: () => onRetried(item.id),
  });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pb-4 sm:px-6">
      <p className="min-w-0 flex-1 text-xs leading-5 text-rose-600 dark:text-rose-400">
        {item.sync_error ?? 'The document could not be imported.'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={pending}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
      >
        {pending ? 'Retrying…' : 'Retry import'}
      </button>
      {needsReconnect ? (
        <Link
          href="/settings"
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400"
        >
          Reconnect GitHub
        </Link>
      ) : null}
      {retryError ? (
        <p role="alert" className="w-full text-xs text-rose-600 dark:text-rose-400">
          {retryError}
        </p>
      ) : null}
    </div>
  );
}

// One importing row's poll loop (2A) — the per-document sibling of the doc
// page's DocumentPoller, on the same shared usePollUntilSettled skeleton (12A).
// Reads the existing per-doc BFF route on the shared cadence; the first
// non-importing read settles the row in place and stops. A transient failure
// (readDocument → null) keeps the last state and retries next tick. Renders
// nothing: it is behaviour, not markup.
function RowPoller({ id, onSettled }: { id: number; onSettled: (doc: Document) => void }) {
  usePollUntilSettled({
    // readDocument already maps a transient failure to null; a still-importing
    // read stays null too, so only a settled doc becomes the payload.
    poll: async (): Promise<Document | null> => {
      const doc = await readDocument(id);
      return doc && doc.status !== 'importing' ? doc : null;
    },
    onSettled,
    key: id,
  });

  return null;
}

// Last-sync state + relative time. A colored dot carries the hue (emerald
// ready, rose failed); an importing row spins (DocumentPoller's treatment). The
// label stays quiet.
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
        <Spinner />
        Importing…
      </span>
    );
  }

  // A ready document whose LATER re-sync failed (SPEC §19): the row must not read
  // healthy emerald while the doc page shows the failure banner. Rose treatment
  // carrying the sync error in a title, checked before the healthy branch.
  if (item.last_sync_status === 'failed') {
    return (
      <span
        title={item.sync_error ?? undefined}
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-rose-600 dark:text-rose-400"
      >
        <Dot className="bg-rose-500" />
        Sync failed
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

// The importing row's spinner — DocumentPoller's exact treatment, sized down for
// a list row, so a doc in flight animates rather than sitting on a static dot.
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-500"
    />
  );
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
