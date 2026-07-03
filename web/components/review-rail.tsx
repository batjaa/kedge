// Static review rail — spike fixture validating the comment-gutter layout
// alongside Fumadocs. Anatomy per docs/DESIGN.md: rounded-2xl panels with a
// header bar / body / action footer; mono status chips; code-things stay dark.
// Real threads arrive with the API in M2.

function StatusChip({ hue, children }: { hue: 'emerald' | 'amber' | 'violet'; children: string }) {
  const styles = {
    emerald: 'ring-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-400',
    amber: 'ring-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-400',
    violet: 'ring-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-400',
  }[hue];
  return (
    <span className={`rounded-lg px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ring-1 ring-inset ${styles}`}>
      {children}
    </span>
  );
}

export function ReviewRail() {
  return (
    <aside className="w-[300px] shrink-0 space-y-5 max-xl:hidden" data-review-rail>
      {/* Open thread */}
      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
        <div className="flex items-center gap-2 border-b border-zinc-900/5 px-4 py-2.5 dark:border-white/5">
          <span className="text-xs font-semibold text-zinc-900 dark:text-white">Thread</span>
          <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">§ this page</span>
          <span className="ms-auto"><StatusChip hue="emerald">open</StatusChip></span>
        </div>
        <div className="space-y-3 px-4 py-3.5">
          <div>
            <div className="flex items-center gap-2 text-xs">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-[9px] text-white">SC</div>
              <span className="font-medium text-zinc-900 dark:text-white">Sarah Chen</span>
              <span className="text-zinc-400 dark:text-zinc-500">3h</span>
            </div>
            <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              What happens when the projection algorithm itself changes between releases? Every anchor silently shifts.
            </p>
          </div>
          <div className="border-l-2 border-zinc-100 pl-3 dark:border-white/10">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-zinc-900 dark:text-white">Batjaa O.</span>
              <span className="rounded-lg px-1.5 font-mono text-[9px] uppercase text-emerald-600 ring-1 ring-inset ring-emerald-400/30 dark:text-emerald-400">author</span>
            </div>
            <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Anchors store a{' '}
              <code className="rounded px-1 font-mono text-xs text-zinc-700 ring-1 ring-inset ring-zinc-300 dark:text-zinc-300 dark:ring-zinc-700">projection_version</code>{' '}
              — a migration re-projects old anchors first.
            </p>
          </div>
        </div>
        <div className="flex gap-4 border-t border-zinc-900/5 px-4 py-2 text-xs text-zinc-400 dark:border-white/5 dark:text-zinc-500">
          <button type="button" className="hover:text-emerald-600 dark:hover:text-emerald-400">Reply</button>
          <button type="button" className="hover:text-emerald-600 dark:hover:text-emerald-400">Resolve</button>
          <button type="button" className="hover:text-emerald-600 dark:hover:text-emerald-400">Fork</button>
          <button type="button" className="ms-auto hover:text-emerald-600 dark:hover:text-emerald-400">Draft reply →</button>
        </div>
      </div>

      {/* Suggestion */}
      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
        <div className="flex items-center gap-2 border-b border-zinc-900/5 px-4 py-2.5 dark:border-white/5">
          <span className="text-xs font-semibold text-zinc-900 dark:text-white">Suggestion</span>
          <span className="ms-auto"><StatusChip hue="amber">pending</StatusChip></span>
        </div>
        <div className="px-4 py-3.5">
          <div className="flex items-center gap-2 text-xs">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-fuchsia-600 text-[9px] text-white">PN</div>
            <span className="font-medium text-zinc-900 dark:text-white">Priya Nair</span>
            <span className="text-zinc-400 dark:text-zinc-500">2h</span>
          </div>
          {/* Diffs stay dark in both themes (DESIGN.md rule 3) */}
          <div className="mt-2.5 overflow-hidden rounded-xl bg-zinc-900 font-mono text-xs ring-1 ring-white/10">
            <p className="px-3 py-1.5 text-rose-400/90"><span className="select-none text-zinc-600">- </span>similarity threshold of 0.75</p>
            <p className="border-t border-zinc-700/50 px-3 py-1.5 text-emerald-400"><span className="select-none text-zinc-600">+ </span>similarity threshold of 0.80</p>
          </div>
          <p className="mt-2.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">hypothes.is ships 0.80 by default — start from their tuned value.</p>
        </div>
        <div className="flex gap-2 border-t border-zinc-900/5 px-4 py-2.5 dark:border-white/5">
          <button type="button" className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15">Accept</button>
          <button type="button" className="rounded-full px-3 py-1 text-xs text-zinc-600 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-50 dark:text-zinc-400 dark:ring-white/10 dark:hover:bg-white/5">Decline</button>
        </div>
      </div>

      {/* Agent thread */}
      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-violet-500/20 dark:bg-violet-400/[.04]">
        <div className="flex items-center gap-2 border-b border-zinc-900/5 px-4 py-2.5 dark:border-white/5">
          <span className="text-xs font-semibold text-zinc-900 dark:text-white">Claude</span>
          <StatusChip hue="violet">agent · mcp</StatusChip>
          <span className="ms-auto text-[10px] text-zinc-400 dark:text-zinc-500">40m</span>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Edge case: the exact match can false-positive on duplicated sentences. Consider weighting the context window by distance from the original position.
          </p>
        </div>
        <div className="flex gap-4 border-t border-zinc-900/5 px-4 py-2 text-xs text-zinc-400 dark:border-white/5 dark:text-zinc-500">
          <button type="button" className="hover:text-violet-600 dark:hover:text-violet-400">Reply</button>
          <button type="button" className="hover:text-violet-600 dark:hover:text-violet-400">Fork</button>
        </div>
      </div>

      {/* Orphan tray */}
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-2xl bg-rose-400/5 px-4 py-2.5 text-xs text-rose-600 ring-1 ring-inset ring-rose-500/20 hover:bg-rose-400/10 dark:text-rose-400"
      >
        ⚠ 1 orphaned from v3 <span className="ms-auto font-medium">Re-attach →</span>
      </button>
    </aside>
  );
}
