'use client';

import { useCallback, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { createTrackedRepo, previewTrackedRepo } from '@/lib/tracked-repos-client';
import { type TrackedRepo } from '@/lib/tracked-repo-scan';
import type { ProjectRef } from '@/lib/document-types';
import { TrackedRepoPreview, type PreviewView } from './tracked-repo-preview';
import { TrackedRepoList } from './tracked-repo-list';
import { EMERALD_BUTTON } from '@/lib/tracked-repo-styles';

// The "Track a repository" panel on a project page (SPEC §16, M3.6, stories
// 7/8/9/12/22). A member pastes a repo URL + path pattern and previews exactly
// which files a scan would import (matches, overlaps 10A, over-cap 18, truncation
// 4A). Confirming persists the tracked repo and runs its first scan (#93): the new
// record joins the list, the page polls it until the scan settles, and its
// settle is reported up (onScanSettled) so the orchestrator materializes the
// reported `import_queued` files as importing rows in THAT repo's source section
// (M3.10 #118) — settling through the existing per-row path (this closes the M3.5
// out-of-band-liveness TODO). The repo list is owned by the parent (ProjectDocuments)
// so tracking or removing a repo here adds/removes its section live. DESIGN.md
// panel tokens.

const BUTTON_CLASS = `shrink-0 px-4 py-2 ${EMERALD_BUTTON}`;

const FIELD_CLASS =
  'mt-1.5 w-full rounded-xl bg-white px-3.5 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-900/10 placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-white/10';

const LABEL_CLASS = 'block text-xs font-medium text-zinc-700 dark:text-zinc-300';

export function TrackedRepoPanel({
  project,
  repos,
  setRepos,
  onScanSettled,
}: {
  /** The page's project — scopes create/preview AND stamps materialized rows (B1). */
  project: ProjectRef;
  /** The attached repos — owned by the parent so each drives its own section (#118). */
  repos: TrackedRepo[];
  setRepos: Dispatch<SetStateAction<TrackedRepo[]>>;
  /** A scan settled: the orchestrator materializes its imports into the repo's section. */
  onScanSettled: (repo: TrackedRepo) => void;
}) {
  const projectId = project.id;
  const [repoUrl, setRepoUrl] = useState('');
  const [ref, setRef] = useState('');
  const [pattern, setPattern] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [view, setView] = useState<PreviewView | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const canPreview = repoUrl.trim() !== '' && pattern.trim() !== '' && !previewing;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPreview) return;

    setPreviewing(true);
    setConfirmError(null);
    setView({ kind: 'loading' });

    try {
      const outcome = await previewTrackedRepo({
        repo_url: repoUrl.trim(),
        ref: ref.trim() === '' ? undefined : ref.trim(),
        path_pattern: pattern.trim(),
        project_id: projectId,
      });
      setView(toView(outcome));
    } catch {
      // A rejected fetch (network blip) must not leave the button stuck spinning.
      setView({ kind: 'error', message: 'Something went wrong checking the repository. Please try again.' });
    } finally {
      setPreviewing(false);
    }
  }

  async function onConfirm() {
    setConfirming(true);
    setConfirmError(null);

    try {
      const outcome = await createTrackedRepo({
        repo_url: repoUrl.trim(),
        ref: ref.trim() === '' ? undefined : ref.trim(),
        path_pattern: pattern.trim(),
        project_id: projectId,
      });

      if (!outcome.ok) {
        setConfirmError(outcome.message);
        return;
      }

      // The record joins the list (pending → the poll takes over); reset the form so
      // the panel is ready for the next repo.
      setRepos((prev) => [outcome.trackedRepo, ...prev]);
      setView(null);
      setRepoUrl('');
      setRef('');
      setPattern('');
    } catch {
      // A rejected fetch must not leave the confirm button stuck on "Starting scan…".
      setConfirmError('Something went wrong starting the scan. Please try again.');
    } finally {
      setConfirming(false);
    }
  }

  const handleScanned = useCallback(
    (repo: TrackedRepo) => {
      setRepos((prev) => prev.map((existing) => (existing.id === repo.id ? repo : existing)));
      // The settle is reported up so the orchestrator materializes this repo's
      // queued imports into its OWN source section (#118), not a shared list.
      onScanSettled(repo);
    },
    [onScanSettled, setRepos],
  );

  // A re-scan just triggered: replace the record with its (optimistically in-flight)
  // self so the poll takes over — nothing to materialize until it settles.
  const handleRescanned = useCallback(
    (repo: TrackedRepo) => {
      setRepos((prev) => prev.map((existing) => (existing.id === repo.id ? repo : existing)));
    },
    [setRepos],
  );

  const handleRemoved = useCallback(
    (id: number) => {
      setRepos((prev) => prev.filter((existing) => existing.id !== id));
    },
    [setRepos],
  );

  return (
    <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-8">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Track a repository</h2>
      <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        Point at a GitHub repo and a path pattern, preview exactly which files match, then import them
        all into this project — kept tracked for a re-scan later.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-3">
        <label htmlFor="tracked-repo-url" className={LABEL_CLASS}>
          Repository URL
        </label>
        <input
          id="tracked-repo-url"
          name="repo_url"
          type="url"
          inputMode="url"
          placeholder="https://github.com/owner/repo"
          value={repoUrl}
          onChange={(event) => setRepoUrl(event.target.value)}
          className={FIELD_CLASS}
        />

        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <div className="sm:w-1/3">
            <label htmlFor="tracked-repo-ref" className={LABEL_CLASS}>
              Branch{' '}
              <span className="font-normal text-zinc-400 dark:text-zinc-500">— optional</span>
            </label>
            <input
              id="tracked-repo-ref"
              name="ref"
              type="text"
              placeholder="default branch"
              value={ref}
              onChange={(event) => setRef(event.target.value)}
              className={FIELD_CLASS}
            />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="tracked-repo-pattern" className={LABEL_CLASS}>
              Path pattern
            </label>
            <input
              id="tracked-repo-pattern"
              name="path_pattern"
              type="text"
              placeholder="docs/**/*.md"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              className={`${FIELD_CLASS} font-mono`}
            />
          </div>
        </div>

        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-500">
          <code className="font-mono">*</code> matches within a folder,{' '}
          <code className="font-mono">**</code> spans folders,{' '}
          <code className="font-mono">?</code> one character — case-sensitive. Only{' '}
          <code className="font-mono">.md</code>, <code className="font-mono">.mdx</code>, and{' '}
          <code className="font-mono">.html</code> files import.
        </p>

        {/* PAT recommendation (spec 4A): unauthenticated GitHub allows only 60
            requests/hour, so a large public repo can exhaust the quota mid-scan. */}
        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-500">
          Tracking a large public repo? Connect the workspace GitHub PAT in Settings for a higher
          rate limit — unauthenticated GitHub allows only 60 requests an hour.
        </p>

        <div className="mt-3">
          <button type="submit" disabled={!canPreview} className={BUTTON_CLASS}>
            {previewing ? 'Previewing…' : 'Preview files'}
          </button>
        </div>
      </form>

      {view ? (
        <TrackedRepoPreview
          view={view}
          onConfirm={onConfirm}
          confirmPending={confirming}
          confirmError={confirmError}
        />
      ) : null}

      <TrackedRepoList
        repos={repos}
        onScanned={handleScanned}
        onRescanned={handleRescanned}
        onRemoved={handleRemoved}
      />
    </div>
  );
}

function toView(outcome: Awaited<ReturnType<typeof previewTrackedRepo>>): PreviewView {
  if (outcome.ok) {
    return { kind: 'matches', files: outcome.preview.files, overlapCount: outcome.preview.overlap_count };
  }
  if (outcome.kind === 'over_cap') return { kind: 'over_cap', message: outcome.message };
  if (outcome.kind === 'truncated') return { kind: 'truncated', message: outcome.message };
  return { kind: 'error', message: outcome.message };
}
