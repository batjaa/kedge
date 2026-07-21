'use client';

import { useState, type FormEvent } from 'react';
import { previewTrackedRepo } from '@/lib/tracked-repos-client';
import { TrackedRepoPreview, type PreviewView } from './tracked-repo-preview';

// The "Track a repository" affordance on a project page (SPEC §16, M3.6, stories
// 7 + 8; DESIGN.md panel idiom). A member pastes a repo URL, an optional branch,
// and a gitignore-style path pattern, then PREVIEWS exactly which files a scan
// would import — matches with overlaps flagged inline (10A), a loud over-cap
// (story 18) or truncation (4A) error, or an empty result. Nothing imports here:
// the confirm/scan step arrives with #93, so the preview's action button is inert.

const BUTTON_CLASS =
  'shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15';

const FIELD_CLASS =
  'mt-1.5 w-full rounded-xl bg-white px-3.5 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-900/10 placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-white/10';

const LABEL_CLASS = 'block text-xs font-medium text-zinc-700 dark:text-zinc-300';

export function TrackedRepoAdd({ projectId }: { projectId: number }) {
  const [repoUrl, setRepoUrl] = useState('');
  const [ref, setRef] = useState('');
  const [pattern, setPattern] = useState('');
  const [pending, setPending] = useState(false);
  const [view, setView] = useState<PreviewView | null>(null);

  const canSubmit = repoUrl.trim() !== '' && pattern.trim() !== '' && !pending;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setPending(true);
    setView({ kind: 'loading' });

    const outcome = await previewTrackedRepo({
      repo_url: repoUrl.trim(),
      ref: ref.trim() === '' ? undefined : ref.trim(),
      path_pattern: pattern.trim(),
      project_id: projectId,
    });

    setView(toView(outcome));
    setPending(false);
  }

  return (
    <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-8">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Track a repository</h2>
      <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        Point at a GitHub repo and a path pattern, then preview exactly which files would import.
        Nothing imports yet — the scan lands next.
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

        <div className="mt-3">
          <button type="submit" disabled={!canSubmit} className={BUTTON_CLASS}>
            {pending ? 'Previewing…' : 'Preview files'}
          </button>
        </div>
      </form>

      {view ? <TrackedRepoPreview view={view} /> : null}
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
