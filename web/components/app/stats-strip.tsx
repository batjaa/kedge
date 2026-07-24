import type { ReactNode } from 'react';
import type { WorkspaceSummary } from '@/lib/document-types';

// The dashboard stats strip (SPEC §16, M3.7; docs/designs/app-dashboard.html).
// It tells the workspace's truth at a glance: documents, open threads, and — only
// when they exist — orphaned threads, stale approvals, and imports in flight. It
// re-reads whenever a row settles/retries/refiles (6A), driven from WorkspaceHome.
//
// Degradation (A1): a null summary (the server seed failed, or a refresh never
// recovered a first read) renders NOTHING — the documents list below is never
// blocked, and the one degraded banner it owns is the only outage signal. The
// three alert stats are conditional so a healthy workspace reads clean rather
// than "0 orphaned · 0 stale". Open Harbor register: quiet zinc text, status
// hues carried by a dot + the number, per the mockup.
export function StatsStrip({ summary }: { summary: WorkspaceSummary | null }) {
  if (summary === null) return null;

  const { documents, threads, approvals } = summary;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
      <Stat value={documents.total} label="documents" />
      <Stat value={threads.open} label="open threads" />
      {threads.orphaned > 0 ? (
        <Stat value={threads.orphaned} label="orphaned" tone="rose" />
      ) : null}
      {approvals.stale > 0 ? (
        <Stat value={approvals.stale} label="approvals stale" tone="amber" />
      ) : null}
      {documents.importing > 0 ? (
        <Stat value={documents.importing} label="importing" tone="sky" pulse />
      ) : null}
    </div>
  );
}

type Tone = 'neutral' | 'rose' | 'amber' | 'sky';

const NUMBER_TONE: Record<Tone, string> = {
  neutral: 'text-zinc-900 dark:text-white',
  rose: 'text-rose-600 dark:text-rose-400',
  amber: 'text-amber-600 dark:text-amber-400',
  sky: 'text-sky-600 dark:text-sky-400',
};

const DOT_TONE: Record<Exclude<Tone, 'neutral'>, string> = {
  rose: 'bg-rose-500 dark:bg-rose-400',
  amber: 'bg-amber-500 dark:bg-amber-400',
  sky: 'bg-sky-500 dark:bg-sky-400',
};

function Stat({
  value,
  label,
  tone = 'neutral',
  pulse = false,
}: {
  value: number;
  label: string;
  tone?: Tone;
  pulse?: boolean;
}) {
  const dot: ReactNode =
    tone === 'neutral' ? null : (
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_TONE[tone]} ${pulse ? 'animate-pulse' : ''}`} />
    );

  return (
    <span className="flex items-center gap-1.5">
      {dot}
      <span className={`font-semibold ${NUMBER_TONE[tone]}`}>{value}</span> {label}
    </span>
  );
}
