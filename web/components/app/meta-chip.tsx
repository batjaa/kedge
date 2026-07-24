import type { ReactNode } from 'react';

export function MetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-lg bg-zinc-400/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-zinc-500 ring-1 ring-inset ring-zinc-400/30 dark:text-zinc-400">
      {children}
    </span>
  );
}
