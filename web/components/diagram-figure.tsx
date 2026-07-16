'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

type ProjectionAttrs = { [key: `data-${string}`]: string | undefined };

// The presentational shell for a rendered diagram (SPEC §6.2), shared by both
// diagram surfaces: the API-mediated component for imported docs (src = a cached
// /storage URL) and the build-time component for the dogfood docs (src = an
// inlined data: URL). Either way the SVG is embedded via <img> — inert, no script
// surface — and the same click-to-zoom lightbox makes complex diagrams legible
// (the spike finding: they shrink to fit the prose column).
//
// Client component: the lightbox needs state, an ESC handler, and scroll lock.
// The <img> itself renders server-side, so a reader with JS disabled still sees
// the diagram — only the zoom affordance needs hydration.

export function DiagramFigure({
  engine,
  src,
  ...projectionAttrs
}: { engine: string; src: string } & ProjectionAttrs) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const alt = `${engine} diagram`;

  const close = useCallback(() => setOpen(false), []);

  // While the lightbox is open: ESC closes it, and the page behind it can't
  // scroll. Focus moves to the close button so keyboard users land inside.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  return (
    <figure
      {...projectionAttrs}
      className="not-prose my-6 overflow-hidden rounded-2xl ring-1 ring-zinc-900/10 dark:ring-white/10"
    >
      {/* Diagrams render on a light surface in both themes for legibility. The
          whole panel is the zoom trigger — a button, so it is keyboard- and
          screen-reader-reachable (DESIGN.md focus rule). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Zoom ${alt}`}
        className="group relative block w-full cursor-zoom-in overflow-x-auto bg-white p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="mx-auto max-w-full" alt={alt} src={src} />
        <span className="absolute right-2 top-2 rounded-lg bg-zinc-900/5 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-zinc-400 opacity-0 ring-1 ring-inset ring-zinc-900/10 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Zoom
        </span>
      </button>
      <figcaption className="border-t border-zinc-900/5 px-4 py-1.5 font-mono text-[10px] uppercase text-zinc-400 dark:border-white/5 dark:text-zinc-500">
        {engine} · rendered via kroki
      </figcaption>

      {open ? (
        // Lightbox: a full-size, scrollable copy of the SVG on a dark scrim.
        // Clicking the scrim (but not the panel) or pressing ESC closes it.
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={close}
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/80 p-4 backdrop-blur-sm sm:p-8"
        >
          <span id={titleId} className="sr-only">
            {alt}, enlarged
          </span>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-full max-w-full overflow-auto rounded-2xl bg-white p-6 ring-1 ring-white/10"
          >
            <button
              ref={closeRef}
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-2 top-2 rounded-full bg-zinc-100 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-zinc-500 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              Esc
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mx-auto block" alt={alt} src={src} />
          </div>
        </div>
      ) : null}
    </figure>
  );
}
