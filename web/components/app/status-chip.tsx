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
        // Amended DESIGN.md chip recipe (Open Harbor): -700 text + -500 tint on
        // light, -400 on dark; neutral metadata rides the zinc-400 tint.
        active
          ? 'bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:bg-amber-400/10 dark:text-amber-400 dark:ring-amber-400/30'
          : 'bg-zinc-400/10 text-zinc-500 ring-zinc-400/30 dark:text-zinc-400',
      )}
    >
      {status.replace('_', ' ')}
    </span>
  );
}
