import type { PreviewFile } from '@/lib/tracked-repos-client';

// The preview result surface (SPEC §16, M3.6, story 8) — a pure view of one
// preview outcome, so every state renders from props alone (statically testable,
// no async). Nothing here imports: matches show what a scan WOULD bring in, with
// overlaps flagged inline (10A); over-cap (story 18) and truncation (4A) are loud
// blocking errors. DESIGN.md panel tokens; mirrors the import-form error idiom.

/** The derived view-model the container hands this component. */
export type PreviewView =
  | { kind: 'loading' }
  | { kind: 'matches'; files: PreviewFile[]; overlapCount: number }
  | { kind: 'over_cap'; message: string }
  | { kind: 'truncated'; message: string }
  | { kind: 'error'; message: string };

const ERROR_CLASS = 'mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20';

export function TrackedRepoPreview({ view }: { view: PreviewView }) {
  if (view.kind === 'loading') {
    return (
      <p role="status" className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
        Checking the repository…
      </p>
    );
  }

  if (view.kind === 'over_cap' || view.kind === 'truncated' || view.kind === 'error') {
    return (
      <p role="alert" className={ERROR_CLASS}>
        {view.message}
      </p>
    );
  }

  // matches (including the empty case — 0 files match)
  if (view.files.length === 0) {
    return (
      <p className="mt-4 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/[.03] dark:text-zinc-400 dark:ring-white/10">
        0 files match this pattern. Adjust the pattern and preview again.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        <span className="font-medium text-zinc-900 dark:text-white">
          {view.files.length} file{view.files.length === 1 ? '' : 's'} match
        </span>
        {view.overlapCount > 0 ? (
          <span className="text-amber-700 dark:text-amber-400">
            {' '}
            · {view.overlapCount} already tracked elsewhere
          </span>
        ) : null}
      </p>

      <ul className="mt-2 divide-y divide-zinc-900/5 rounded-xl ring-1 ring-inset ring-zinc-900/10 dark:divide-white/5 dark:ring-white/10">
        {view.files.map((file) => (
          <li key={file.path} className="flex items-center justify-between gap-3 px-3.5 py-2">
            <code className="min-w-0 truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
              {file.path}
            </code>
            {file.overlap ? (
              <span
                title="Another tracked repo in this workspace already imports this path — importing here would duplicate it."
                className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-400/10 dark:text-amber-300"
              >
                Already tracked
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Importing arrives with the scan (#93) — the affordance is present but
            inert so the flow reads end-to-end. */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="rounded-full bg-zinc-900/40 px-4 py-1.5 text-sm font-medium text-white/80 dark:bg-white/10 dark:text-white/60"
        >
          Add &amp; scan
        </button>
        <span className="text-xs text-zinc-500 dark:text-zinc-500">
          Next: scan imports these files into the project (arrives with #93).
        </span>
      </div>
    </div>
  );
}
