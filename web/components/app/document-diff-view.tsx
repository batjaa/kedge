'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ArrowRight, MessageSquare } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { listThreads } from '@/lib/comments-client';
import type { DocumentVersionDiff, VersionDiffVersion } from '@/lib/document-types';
import {
  inlineDiffSegments,
  locateAnchorInSegments,
  makeInlineDiffOperations,
  type DiffAnchorPlacement,
  type DiffAnchorSide,
  type InlineDiffKind,
  type InlineDiffSegment,
} from '@/lib/inline-diff';
import { renderCommentMarkdown } from '@/lib/render-comment-markdown';
import { formatRelativeTime } from '@/lib/intl-time';
import type { ReviewThread } from '@/lib/thread-types';
import { cn } from '@/lib/cn';
import { ApprovalRoster } from './approval-roster';
import { MetaChip } from './meta-chip';

const DIFF_THREAD_PAGE_SIZE = 50;

interface DiffThreadMarker {
  key: string;
  displayLabel: string;
  side: DiffAnchorSide;
  thread: ReviewThread;
  placement: DiffAnchorPlacement;
}

interface DiffThreadEntry {
  key: string;
  displayLabel: string;
  side: DiffAnchorSide;
  thread: ReviewThread;
  placement: DiffAnchorPlacement | null;
}

export function DocumentDiffView({ diff }: { diff: DocumentVersionDiff }) {
  const t = useTranslations('diff');
  const [threadsA, setThreadsA] = useState<ReviewThread[]>([]);
  const [threadsB, setThreadsB] = useState<ReviewThread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const textA = diff.versions.a.plain_text ?? '';
  const textB = diff.versions.b.plain_text ?? '';
  const operations = useMemo(() => makeInlineDiffOperations(textA, textB), [textA, textB]);
  const segments = useMemo(() => inlineDiffSegments(operations), [operations]);
  const entries = useMemo(() => [
    ...threadEntriesForSide(threadsA, 'a', segments),
    ...threadEntriesForSide(threadsB, 'b', segments),
  ], [segments, threadsA, threadsB]);
  const markers = useMemo(
    () => entries.flatMap((entry): DiffThreadMarker[] => entry.placement ? [{ ...entry, placement: entry.placement }] : []),
    [entries],
  );
  const markersBySegment = useMemo(() => groupMarkersBySegment(markers), [markers]);
  const openThreadCount = entries.filter((entry) => entry.thread.status === 'open').length;

  useEffect(() => {
    let cancelled = false;

    async function loadThreads() {
      setLoadingThreads(true);
      const [nextThreadsA, nextThreadsB] = await Promise.all([
        loadVersionThreads(diff.document.id, diff.versions.a.id),
        loadVersionThreads(diff.document.id, diff.versions.b.id),
      ]);

      if (cancelled) return;
      setThreadsA(nextThreadsA);
      setThreadsB(nextThreadsB);
      setLoadingThreads(false);
    }

    void loadThreads();

    return () => {
      cancelled = true;
    };
  }, [diff.document.id, diff.versions.a.id, diff.versions.b.id]);

  const activate = (key: string) => {
    setActiveKey(key);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-diff-thread-card="${key}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  const focusMarker = (key: string) => {
    setActiveKey(key);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-diff-marker="${key}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  return (
    <div>
      <DiffHeader
        diff={diff}
        openThreadCount={openThreadCount}
      />

      <div className="mx-auto grid max-w-7xl grid-cols-1 items-start gap-8 px-6 py-8 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <article className="min-w-0">
          <div className="overflow-hidden rounded-lg bg-white ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-900/10 px-4 py-3 dark:border-white/10">
              <MetaChip>{diff.versions.a.label}</MetaChip>
              <ArrowRight className="h-4 w-4 text-zinc-400" aria-hidden="true" />
              <MetaChip>{diff.versions.b.label}</MetaChip>
              <span className="ml-auto font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                {t('projection', { version: diff.versions.a.projection_version ?? '' })}
              </span>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words p-4 font-mono text-[13px] leading-6 text-zinc-800 dark:text-zinc-200">
              <code>
                {segments.map((segment, index) => (
                  <DiffSegmentView
                    key={`${segment.kind}:${segment.renderedStart}:${segment.renderedEnd}`}
                    segment={segment}
                    markers={markersBySegment.get(index) ?? []}
                    activeKey={activeKey}
                    onActivateMarker={activate}
                  />
                ))}
              </code>
            </pre>
          </div>
        </article>

        <aside className="space-y-5 xl:sticky xl:top-32">
          {loadingThreads ? (
            <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              {t('loadingThreads')}
            </p>
          ) : null}

          <DiffThreadList
            title={t('anchorsTitle', { label: diff.versions.a.label })}
            side="a"
            version={diff.versions.a}
            entries={entries.filter((entry) => entry.side === 'a')}
            activeKey={activeKey}
            onFocusMarker={focusMarker}
          />
          <DiffThreadList
            title={t('anchorsTitle', { label: diff.versions.b.label })}
            side="b"
            version={diff.versions.b}
            entries={entries.filter((entry) => entry.side === 'b')}
            activeKey={activeKey}
            onFocusMarker={focusMarker}
          />
        </aside>
      </div>
    </div>
  );
}

function DiffHeader({
  diff,
  openThreadCount,
}: {
  diff: DocumentVersionDiff;
  openThreadCount: number;
}) {
  const t = useTranslations('diff');
  const locale = useLocale();
  const currentVersionLabel = diff.current_version?.label ?? null;

  return (
    <header className="sticky top-14 z-30 border-b border-zinc-900/10 bg-white/90 px-6 py-3 backdrop-blur dark:border-white/10 dark:bg-zinc-900/90">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/documents/${diff.document.id}?version=${diff.versions.b.id}`}
            className="mb-1 inline-flex text-sm text-emerald-600 hover:text-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400"
          >
            ← {t('backToDocument')}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <MetaChip>{diff.versions.a.label}</MetaChip>
            <ArrowRight className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            <MetaChip>{diff.versions.b.label}</MetaChip>
            {currentVersionLabel ? <MetaChip>{t('current', { label: currentVersionLabel })}</MetaChip> : null}
            <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{t('plainTextDiff')}</span>
          </div>
          <h1 className="mt-1 truncate text-xl font-semibold text-zinc-900 dark:text-white sm:text-2xl">
            {diff.document.title}
          </h1>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-500">
            <span>{versionSyncedLabel(diff.versions.a, t, locale)}</span>
            <span>{versionSyncedLabel(diff.versions.b, t, locale)}</span>
          </div>
          <ApprovalRoster approvals={diff.approvals} currentVersionLabel={currentVersionLabel} />
        </div>
        <div className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-zinc-700 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
          <MessageSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <span>{t('openCount', { count: openThreadCount })}</span>
        </div>
      </div>
    </header>
  );
}

function DiffSegmentView({
  segment,
  markers,
  activeKey,
  onActivateMarker,
}: {
  segment: InlineDiffSegment;
  markers: DiffThreadMarker[];
  activeKey: string | null;
  onActivateMarker: (key: string) => void;
}) {
  const t = useTranslations('diff');

  return (
    <span className={segmentClassName(segment.kind)}>
      {renderTextWithMarkers(segment.text, markers, activeKey, onActivateMarker, t)}
    </span>
  );
}

function renderTextWithMarkers(
  text: string,
  markers: DiffThreadMarker[],
  activeKey: string | null,
  onActivateMarker: (key: string) => void,
  t: ReturnType<typeof useTranslations>,
) {
  if (markers.length === 0) return text;

  const markersByOffset = new Map<number, DiffThreadMarker[]>();
  for (const marker of markers) {
    const bucket = markersByOffset.get(marker.placement.offset) ?? [];
    bucket.push(marker);
    markersByOffset.set(marker.placement.offset, bucket);
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const offset of [...markersByOffset.keys()].sort((left, right) => left - right)) {
    if (offset > cursor) nodes.push(text.slice(cursor, offset));
    nodes.push(
      <span key={`marker:${offset}`} className="inline-flex align-middle">
        {markersByOffset.get(offset)!.map((marker) => (
          <button
            key={marker.key}
            type="button"
            data-diff-marker={marker.key}
            onClick={() => onActivateMarker(marker.key)}
            className={cn(
              'mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-sans text-[10px] font-semibold leading-none ring-1 ring-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
              diffSideMarkerClassName(marker.side),
              activeKey === marker.key ? 'ring-2 ring-zinc-900 dark:ring-white' : null,
            )}
            aria-label={t('threadMarker', { version: marker.side === 'a' ? t('versionA') : t('versionB'), id: marker.thread.id })}
          >
            {marker.displayLabel}
          </button>
        ))}
      </span>,
    );
    cursor = offset;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function DiffThreadList({
  title,
  side,
  version,
  entries,
  activeKey,
  onFocusMarker,
}: {
  title: string;
  side: DiffAnchorSide;
  version: VersionDiffVersion;
  entries: DiffThreadEntry[];
  activeKey: string | null;
  onFocusMarker: (key: string) => void;
}) {
  const t = useTranslations('diff');
  const format = useFormatter();

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <MetaChip>{side === 'a' ? 'A' : 'B'}</MetaChip>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">{title}</h2>
        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-500">{format.number(entries.length)}</span>
      </div>
      <div className="space-y-3">
        {entries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            {t('noAnchoredThreads', { label: version.label })}
          </p>
        ) : null}
        {entries.map((entry) => (
          <DiffThreadCard
            key={entry.key}
            entry={entry}
            active={activeKey === entry.key}
            onFocusMarker={onFocusMarker}
          />
        ))}
      </div>
    </section>
  );
}

function DiffThreadCard({
  entry,
  active,
  onFocusMarker,
}: {
  entry: DiffThreadEntry;
  active: boolean;
  onFocusMarker: (key: string) => void;
}) {
  const t = useTranslations('diff');
  const tThreads = useTranslations('threads');
  const comment = entry.thread.first_comment ?? entry.thread.comments?.[0] ?? null;
  const hasMarker = entry.placement !== null;
  const body = comment && !comment.is_deleted && (comment.body_md ?? '').trim() !== ''
    ? renderCommentMarkdown(comment.body_md ?? '', comment.mentions)
    : null;

  return (
    <article
      data-diff-thread-card={entry.key}
      className={cn(
        'rounded-lg bg-white p-3 text-sm ring-1 ring-inset dark:bg-white/[.03]',
        active
          ? 'ring-emerald-500/60'
          : 'ring-zinc-900/10 dark:ring-white/10',
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!hasMarker}
          onClick={() => onFocusMarker(entry.key)}
          className={cn(
            'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-mono text-[11px] font-semibold ring-1 ring-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50',
            diffSideMarkerClassName(entry.side),
          )}
          title={hasMarker ? t('jumpToMarker') : t('anchorNotPlacedTitle')}
        >
          {entry.displayLabel}
        </button>
        <span className="font-medium text-zinc-900 dark:text-white">
          {t('threadNumber', { id: entry.thread.id })}
        </span>
        <span className="ml-auto rounded-lg bg-zinc-400/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-zinc-500 ring-1 ring-inset ring-zinc-400/30 dark:text-zinc-400">
          {tThreads(`status.${entry.thread.status}`)}
        </span>
      </div>
      {entry.thread.anchor ? (
        <blockquote className="mt-3 border-l-2 border-zinc-300 pl-3 text-xs leading-5 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {entry.thread.anchor.exact}
        </blockquote>
      ) : null}
      {body ? (
        <div className="mt-3 line-clamp-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          {body}
        </div>
      ) : null}
      {!hasMarker ? (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
          {t('anchorNotPlaced')}
        </p>
      ) : null}
    </article>
  );
}

function threadEntriesForSide(
  threads: ReviewThread[],
  side: DiffAnchorSide,
  segments: InlineDiffSegment[],
): DiffThreadEntry[] {
  let index = 0;

  return threads.flatMap((thread): DiffThreadEntry[] => {
    if (!thread.anchor) return [];

    index += 1;
    const placement = thread.anchor.state !== 'orphaned'
      ? locateAnchorInSegments(segments, side, thread.anchor)
      : null;

    return [{
      key: `${side}:${thread.id}`,
      displayLabel: `${side.toUpperCase()}${index}`,
      side,
      thread,
      placement,
    }];
  });
}

async function loadVersionThreads(documentId: number, versionId: number): Promise<ReviewThread[]> {
  const firstPage = await listThreads(documentId, 1, versionId, DIFF_THREAD_PAGE_SIZE);
  const lastPage = firstPage.meta?.last_page ?? 1;
  if (lastPage <= 1) return firstPage.data;

  const remainingPages = await Promise.all(
    Array.from({ length: lastPage - 1 }, (_, index) => (
      listThreads(documentId, index + 2, versionId, DIFF_THREAD_PAGE_SIZE)
    )),
  );

  return [firstPage, ...remainingPages].flatMap((page) => page.data);
}

function groupMarkersBySegment(markers: DiffThreadMarker[]): Map<number, DiffThreadMarker[]> {
  const grouped = new Map<number, DiffThreadMarker[]>();

  for (const marker of markers) {
    const bucket = grouped.get(marker.placement.segmentIndex) ?? [];
    bucket.push(marker);
    grouped.set(marker.placement.segmentIndex, bucket);
  }

  return grouped;
}

function diffSideMarkerClassName(side: DiffAnchorSide): string {
  return side === 'a'
    ? 'bg-rose-100 text-rose-700 ring-rose-400/40 dark:bg-rose-400/15 dark:text-rose-200 dark:ring-rose-400/35'
    : 'bg-emerald-100 text-emerald-700 ring-emerald-400/40 dark:bg-emerald-400/15 dark:text-emerald-200 dark:ring-emerald-400/35';
}

function versionSyncedLabel(
  version: VersionDiffVersion,
  t: ReturnType<typeof useTranslations>,
  locale: string,
): string {
  const synced = formatRelativeTime(version.synced_at, locale);

  return synced === ''
    ? t('syncUnavailable', { label: version.label })
    : t('synced', { label: version.label, when: synced });
}

function segmentClassName(kind: InlineDiffKind): string {
  if (kind === 'insert') {
    return 'bg-emerald-400/15 text-emerald-900 dark:text-emerald-100';
  }

  if (kind === 'delete') {
    return 'bg-rose-400/15 text-rose-900 line-through decoration-rose-500/70 dark:text-rose-100';
  }

  return '';
}
