import { cn } from '@/lib/cn';
import type { LifecycleStatus } from '@/lib/document-types';

// The lifecycle chip (DESIGN.md): amber only for in-review, neutral zinc
// otherwise — status hues live in chips, never in prose. Shared by the review
// header and the documents-list row so the two can never drift (one was a
// verbatim copy of the other before this was extracted).
export function StatusChip({ status }: { status: LifecycleStatus }) {
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
