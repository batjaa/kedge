'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { createProject } from '@/lib/projects-client';
import type { Project } from '@/lib/document-types';

// The create-project affordance on the home (SPEC §16, M3.6; DESIGN.md panel
// idiom). A workspace member names a project — required, ≤100 chars, unique per
// workspace, the API's 6A rules surfaced inline — with an optional description.
// On success it hands the new project up (onCreated) so the row chips and group
// headers gain it at once, and links to its (empty) page so the next step —
// filling it — is one click away. Panel idiom, DESIGN.md tokens.
const BUTTON_CLASS =
  'shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15';

export function ProjectCreate({ onCreated }: { onCreated: (project: Project) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Project | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || name.trim() === '') return;

    setPending(true);
    setError(null);

    const outcome = await createProject(name, description);

    if (outcome.ok) {
      onCreated(outcome.project);
      setCreated(outcome.project);
      setName('');
      setDescription('');
      setPending(false);
      return;
    }

    setError(outcome.kind === 'validation' ? outcome.errors.name?.[0] ?? outcome.message : outcome.message);
    setPending(false);
  }

  const fieldRing = error
    ? 'ring-rose-500/50 focus-visible:ring-rose-500'
    : 'ring-zinc-900/10 focus-visible:ring-emerald-500 dark:ring-white/10';

  return (
    <div className="mt-6 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-8">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Projects</h2>
      <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        Group your documents by what you&apos;re working on. Your list below reads as one section per project.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-3">
        <label htmlFor="project-name" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Project name
        </label>
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <input
            id="project-name"
            name="project-name"
            type="text"
            placeholder="Anchoring"
            maxLength={100}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError(null);
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'project-error' : undefined}
            className={`w-full min-w-0 flex-1 rounded-xl bg-white px-3.5 py-2 text-sm text-zinc-900 ring-1 ring-inset placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 dark:bg-white/[.03] dark:text-white ${fieldRing}`}
          />
          <button type="submit" disabled={pending || name.trim() === ''} className={BUTTON_CLASS}>
            {pending ? 'Creating…' : 'Create project'}
          </button>
        </div>

        <label htmlFor="project-description" className="mt-3 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Description{' '}
          <span className="font-normal text-zinc-400 dark:text-zinc-500">— optional</span>
        </label>
        <input
          id="project-description"
          name="project-description"
          type="text"
          placeholder="What this project is for"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="mt-1.5 w-full rounded-xl bg-white px-3.5 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-900/10 placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-white/10"
        />

        {error ? (
          <p id="project-error" role="alert" className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">
            {error}
          </p>
        ) : created ? (
          <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            Created{' '}
            <Link
              href={`/projects/${created.id}`}
              className="font-medium text-emerald-700 hover:text-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400"
            >
              {created.name}
            </Link>
            . Assign documents to it from any row&apos;s project chip.
          </p>
        ) : null}
      </form>
    </div>
  );
}
