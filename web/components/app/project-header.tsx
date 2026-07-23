'use client';

import { useState, type FormEvent } from 'react';
import { updateProject } from '@/lib/projects-client';
import type { Project } from '@/lib/document-types';

// A project page's editable header (SPEC §16 story 2, M3.6): the project name
// and description, with an inline rename/re-describe form behind an Edit toggle.
// The name obeys the same 6A rules the API enforces; a collision surfaces inline.
// Client-owned so a rename updates in place without a full navigation.
export function ProjectHeader({ project }: { project: Project }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const [draftDescription, setDraftDescription] = useState(project.description ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setDraftName(name);
    setDraftDescription(description);
    setError(null);
    setEditing(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || draftName.trim() === '') return;

    setPending(true);
    setError(null);

    const outcome = await updateProject(project.id, {
      name: draftName.trim(),
      description: draftDescription.trim() === '' ? null : draftDescription.trim(),
    });

    if (outcome.ok) {
      setName(outcome.project.name);
      setDescription(outcome.project.description ?? '');
      setEditing(false);
      setPending(false);
      return;
    }

    setError(outcome.kind === 'validation' ? outcome.errors.name?.[0] ?? outcome.message : outcome.message);
    setPending(false);
  }

  if (editing) {
    return (
      <form onSubmit={onSubmit} noValidate className="mt-2">
        <label htmlFor="project-edit-name" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Project name
        </label>
        <input
          id="project-edit-name"
          type="text"
          maxLength={100}
          value={draftName}
          onChange={(event) => {
            setDraftName(event.target.value);
            if (error) setError(null);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'project-edit-error' : undefined}
          className="mt-1.5 w-full max-w-lg rounded-xl bg-white px-3.5 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-900/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-white/10"
        />

        <label htmlFor="project-edit-description" className="mt-3 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Description{' '}
          <span className="font-normal text-zinc-400 dark:text-zinc-500">— optional</span>
        </label>
        <input
          id="project-edit-description"
          type="text"
          value={draftDescription}
          onChange={(event) => setDraftDescription(event.target.value)}
          className="mt-1.5 w-full max-w-lg rounded-xl bg-white px-3.5 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-900/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-white/10"
        />

        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            disabled={pending || draftName.trim() === ''}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-full px-4 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Cancel
          </button>
        </div>

        {error ? (
          <p id="project-edit-error" role="alert" className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">{name}</h1>
        <button
          type="button"
          onClick={startEditing}
          className="rounded-full px-2.5 py-1 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/5"
        >
          Edit
        </button>
      </div>
      {description ? (
        <p className="mt-2 max-w-2xl text-sm leading-7 text-zinc-600 dark:text-zinc-400">{description}</p>
      ) : (
        <p className="mt-2 text-sm italic leading-7 text-zinc-400 dark:text-zinc-500">No description yet.</p>
      )}
    </div>
  );
}
