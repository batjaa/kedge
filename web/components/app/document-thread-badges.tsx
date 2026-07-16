import { cn } from '@/lib/cn';
import type { SuggestionStatus, ThreadStatus } from '@/lib/thread-types';

export function StatusBadge({ status, suggestion, agent }: { status: ThreadStatus; suggestion: boolean; agent: boolean }) {
  const classes = agent
    ? 'ring-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-400'
    : suggestion
      ? 'ring-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-400'
      : status === 'resolved'
        ? 'ring-zinc-400/30 text-zinc-500 dark:text-zinc-400'
        : 'ring-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-400';

  return (
    <span className={cn('rounded-lg px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ring-1 ring-inset', classes)}>
      {agent ? 'agent' : suggestion ? 'sugg' : status}
    </span>
  );
}

export function SuggestionStatusBadge({ status }: { status: SuggestionStatus }) {
  const classes = {
    pending: 'ring-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-400',
    accepted: 'ring-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-400',
    declined: 'ring-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-400',
  }[status];

  return (
    <span className={cn('rounded-lg px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ring-1 ring-inset', classes)}>
      {status}
    </span>
  );
}

export function AgentBadge() {
  return (
    <span className="rounded-lg bg-violet-400/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-violet-600 ring-1 ring-inset ring-violet-400/30 dark:text-violet-400">
      mcp
    </span>
  );
}
