import type { PreviewFile } from '@/lib/tracked-repos-client';
import { EMERALD_BUTTON, PILL_BASE, ROSE_PANEL } from '@/lib/tracked-repo-styles';

// The preview result surface (SPEC §16, M3.6, stories 8 + 9) — a pure view of one
// preview outcome, so every state renders from props alone (statically testable,
// no async). Matches show what a scan WOULD bring in, with overlaps flagged inline
// (10A); over-cap (story 18) and truncation (4A) are loud blocking errors. The
// matches state carries an active "Add & scan" confirm (wired by the container,
// #93): pressing it persists the tracked repo and runs the first scan. DESIGN.md
// panel tokens; mirrors the import-form error idiom.

/** The derived view-model the container hands this component. */
export type PreviewView =
  | { kind: 'loading' }
  | { kind: 'matches'; files: PreviewFile[]; overlapCount: number }
  | { kind: 'over_cap'; message: string }
  | { kind: 'truncated'; message: string }
  | { kind: 'error'; message: string };

const ERROR_CLASS = `mt-4 p-4 ${ROSE_PANEL}`;

const CONFIRM_CLASS = `px-4 py-1.5 ${EMERALD_BUTTON}`;

export function TrackedRepoPreview({
  view,
  onConfirm,
  confirmPending,
  confirmError,
}: {
  view: PreviewView;
  /** Persist the tracked repo and run its first scan (#93). Always wired by the panel. */
  onConfirm: () => void;
  confirmPending: boolean;
  confirmError: string | null;
}) {
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
                className={`${PILL_BASE} bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300`}
              >
                Already tracked
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmPending}
          className={CONFIRM_CLASS}
        >
          {confirmPending ? 'Starting scan…' : 'Add & scan'}
        </button>
        <span className="text-xs text-zinc-500 dark:text-zinc-500">
          Imports these files into the project and keeps the repo tracked.
        </span>
      </div>

      {confirmError ? (
        <p role="alert" className={ERROR_CLASS}>
          {confirmError}
        </p>
      ) : null}
    </div>
  );
}
