import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const TEXTAREA_CLASS_NAME = 'block w-full resize-none rounded-lg border-0 bg-zinc-50 p-2 text-xs leading-5 text-zinc-900 ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-zinc-700';

export function IconButton({
  title,
  disabled = false,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:ring-white/10 dark:hover:bg-white/5 dark:hover:text-white"
    >
      {children}
    </button>
  );
}

export function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
        active
          ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:text-white dark:ring-white/10'
          : 'text-zinc-600 hover:bg-white/70 dark:text-zinc-400 dark:hover:bg-white/5',
      )}
    >
      {children}
    </button>
  );
}
