// The non-success diagram states (SPEC §6.2), shared by both diagram surfaces.
// Plain server components — no client JS — so a loading or failed diagram costs
// the reader nothing to hydrate.

/**
 * Loading skeleton, shown as the Suspense fallback while the API-mediated
 * component awaits the cached-SVG URL during server render (the only genuinely
 * async diagram path). A calm panel in the diagram's own footprint, not a
 * spinner, so streaming in the real diagram doesn't jump the layout.
 */
export function DiagramSkeleton({ engine }: { engine: string }) {
  return (
    <figure className="not-prose my-6 overflow-hidden rounded-2xl ring-1 ring-zinc-900/10 dark:ring-white/10">
      <div className="flex h-40 animate-pulse items-center justify-center bg-zinc-50 dark:bg-white/[.02]">
        <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-300 dark:text-zinc-600">
          rendering {engine}…
        </span>
      </div>
      <div className="border-t border-zinc-900/5 px-4 py-1.5 font-mono text-[10px] uppercase text-zinc-300 dark:border-white/5 dark:text-zinc-600">
        {engine} · rendered via kroki
      </div>
    </figure>
  );
}

/**
 * The never-crash error panel (hard rule #2): a Kroki failure or a bad-source
 * diagram shows its raw source with an error chip, so a diagram hiccup can never
 * take down the page. Rose = the DESIGN.md danger hue, confined to the chip/ring.
 */
export function DiagramSourceError({ engine, source }: { engine: string; source: string }) {
  return (
    <div className="not-prose my-6 rounded-2xl bg-rose-400/5 p-4 ring-1 ring-inset ring-rose-500/20">
      <p className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
        <span className="rounded-lg bg-rose-400/10 px-1.5 py-0.5 ring-1 ring-inset ring-rose-400/30">
          {engine}
        </span>
        render failed — showing source
      </p>
      <pre className="overflow-x-auto font-mono text-xs text-zinc-600 dark:text-zinc-400">{source}</pre>
    </div>
  );
}
