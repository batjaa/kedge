import type { ReactNode } from 'react';

export function MetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-lg px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-zinc-500 ring-1 ring-inset ring-zinc-300 dark:text-zinc-400 dark:ring-zinc-700">
      {children}
    </span>
  );
}
