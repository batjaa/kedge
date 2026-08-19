import type { ReactNode } from 'react';
import { AI_ICON_TONE_CLASS } from './ai-tone';
import { cn } from '@/lib/cn';

export const TEXTAREA_CLASS_NAME = 'block w-full resize-none rounded-lg border-0 bg-zinc-50 p-2 text-xs leading-5 text-zinc-900 ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/[.03] dark:text-white dark:ring-zinc-700';

/** The neutral square: a human action on a thread or comment. */
const ICON_TONE_CLASS =
  'text-zinc-500 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:ring-white/10 dark:hover:bg-white/5 dark:hover:text-white';

export function IconButton({
  title,
  disabled = false,
  tone = 'neutral',
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  /** `agent` puts the square in the violet register: clicking it leads to a model run. */
  tone?: 'neutral' | 'agent';
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
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'agent' ? AI_ICON_TONE_CLASS : ICON_TONE_CLASS,
      )}
    >
      {children}
    </button>
  );
}

export function ModeButton({
  active,
  disabled = false,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60',
        active
          ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:text-white dark:ring-white/10'
          : 'text-zinc-600 hover:bg-white/70 dark:text-zinc-400 dark:hover:bg-white/5',
      )}
    >
      {children}
    </button>
  );
}
