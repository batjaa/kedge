'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * The modal shell every document-header AI artifact opens (DESIGN.md): heading,
 * one-line description, body, and a right-aligned action row.
 *
 * Portaled to <body> on purpose: the trigger sits inside the sticky header,
 * whose backdrop-blur makes it the containing block for fixed descendants —
 * rendered in place, this overlay would be confined to the header strip.
 *
 * Presentational and artifact-agnostic; the panels above it own the run, the
 * copy, and every word.
 */
export function AiArtifactDialog({
  open,
  onClose,
  label,
  heading,
  description,
  closeLabel,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  heading: string;
  description: string;
  closeLabel: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6"
    >
      <button
        type="button"
        aria-label={closeLabel}
        className="fixed inset-0 cursor-default bg-zinc-900/45"
        onClick={onClose}
      />

      <div className="relative z-10 mt-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-900 dark:ring-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white">{heading}</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-white/5 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4">{children}</div>

        {actions ? <div className="mt-5 flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The header's AI buttons, shared so the digest and the improve-prompt read as
 * one row of controls. The agent register is violet per DESIGN.md.
 */
export const AI_BUTTON_CLASS =
  'inline-flex items-center gap-2 rounded-full bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-1 dark:ring-inset dark:ring-violet-400/20 dark:hover:bg-violet-400/15';

export const AI_SECONDARY_BUTTON_CLASS =
  'inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3.5 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-white/5 dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-white/10';
