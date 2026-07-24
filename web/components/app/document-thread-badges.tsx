import { cn } from '@/lib/cn';
import type { SuggestionStatus, ThreadStatus } from '@/lib/thread-types';

// Amended DESIGN.md chip recipe (Open Harbor): -500 tint + -700 text on light,
// -400 on dark; neutral metadata rides the zinc-400 tint.
export function StatusBadge({ status, suggestion, agent }: { status: ThreadStatus; suggestion: boolean; agent: boolean }) {
  const classes = agent
    ? 'ring-violet-500/30 bg-violet-500/10 text-violet-700 dark:ring-violet-400/30 dark:bg-violet-400/10 dark:text-violet-400'
    : suggestion
      ? 'ring-amber-500/30 bg-amber-500/10 text-amber-700 dark:ring-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400'
      : status === 'resolved'
        ? 'ring-zinc-400/30 bg-zinc-400/10 text-zinc-500 dark:text-zinc-400'
        : 'ring-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:ring-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-400';

  return (
    <span className={cn('rounded-lg px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ring-1 ring-inset', classes)}>
      {agent ? 'agent' : suggestion ? 'sugg' : status}
    </span>
  );
}

export function SuggestionStatusBadge({ status }: { status: SuggestionStatus }) {
  const classes = {
    pending: 'ring-amber-500/30 bg-amber-500/10 text-amber-700 dark:ring-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400',
    accepted: 'ring-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:ring-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-400',
    declined: 'ring-rose-500/30 bg-rose-500/10 text-rose-700 dark:ring-rose-400/30 dark:bg-rose-400/10 dark:text-rose-400',
  }[status];

  return (
    <span className={cn('rounded-lg px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ring-1 ring-inset', classes)}>
      {status}
    </span>
  );
}

export function AgentBadge() {
  return (
    <span className="rounded-lg bg-violet-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-violet-700 ring-1 ring-inset ring-violet-500/30 dark:bg-violet-400/10 dark:text-violet-400 dark:ring-violet-400/30">
      mcp
    </span>
  );
}
