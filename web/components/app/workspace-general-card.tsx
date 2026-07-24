'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Workspace } from '@/lib/auth-types';
import { updateWorkspace } from '@/lib/workspace-client';

// Workspace settings — General (SPEC §16, M3.7 decision 11A). A self-contained
// client island: the owner edits the workspace name and slug and saves. On
// success it refreshes the server tree (router.refresh) so the new name shows
// wherever the chrome reads it from the session. A slug clash comes back as a
// 422 and lands inline under the field. Open Harbor register, DESIGN.md tokens,
// no webfonts (the panel title inherits the display face via the heading rule).
//
// Sits ABOVE the integrations panel on the settings page.
export function WorkspaceGeneralCard({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; slug?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedSlug = slug.trim();
  const dirty = trimmedName !== workspace.name || trimmedSlug !== workspace.slug;
  const canSave = dirty && trimmedName !== '' && trimmedSlug !== '' && !saving;

  async function onSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});

    // Send only what changed — the endpoint is partial (a no-op field is never
    // re-validated for uniqueness against its own row).
    const fields: { name?: string; slug?: string } = {};
    if (trimmedName !== workspace.name) fields.name = trimmedName;
    if (trimmedSlug !== workspace.slug) fields.slug = trimmedSlug;

    const outcome = await updateWorkspace(fields);

    if (outcome.ok) {
      setName(outcome.workspace.name);
      setSlug(outcome.workspace.slug);
      setNotice('Workspace updated.');
      // Reflect the new name across the server-rendered chrome (this page's
      // heading, the dashboard greeting) without a full reload.
      router.refresh();
    } else if (outcome.kind === 'validation') {
      setFieldErrors({
        name: outcome.errors.name?.[0],
        slug: outcome.errors.slug?.[0],
      });
      // A message with no per-field entry (rare) still surfaces at the footer.
      if (!outcome.errors.name && !outcome.errors.slug) setError(outcome.message);
    } else {
      setError(outcome.message);
    }

    setSaving(false);
  }

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-8">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-white">General</h2>
      <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        The name and handle for your workspace. The name shows across the app; the slug is its
        URL-safe handle.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (fieldErrors.name) setFieldErrors((p) => ({ ...p, name: undefined }));
              if (notice) setNotice(null);
            }}
            aria-label="Workspace name"
            aria-invalid={Boolean(fieldErrors.name)}
            className={`mt-1 w-full rounded-full bg-stone-50 px-3.5 py-2 text-sm text-zinc-900 ring-1 ring-inset placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 dark:bg-white/5 dark:text-white ${
              fieldErrors.name
                ? 'ring-rose-500/50 focus-visible:ring-rose-500'
                : 'ring-zinc-900/10 focus-visible:ring-emerald-500 dark:ring-white/10'
            }`}
          />
          {fieldErrors.name ? (
            <span role="alert" className="mt-1.5 block text-xs text-rose-600 dark:text-rose-400">
              {fieldErrors.name}
            </span>
          ) : null}
        </label>

        <label className="block">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Slug</span>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              if (fieldErrors.slug) setFieldErrors((p) => ({ ...p, slug: undefined }));
              if (notice) setNotice(null);
            }}
            aria-label="Workspace slug"
            aria-invalid={Boolean(fieldErrors.slug)}
            className={`mt-1 w-full rounded-full bg-stone-50 px-3.5 py-2 font-mono text-sm text-zinc-900 ring-1 ring-inset placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 dark:bg-white/5 dark:text-white ${
              fieldErrors.slug
                ? 'ring-rose-500/50 focus-visible:ring-rose-500'
                : 'ring-zinc-900/10 focus-visible:ring-emerald-500 dark:ring-white/10'
            }`}
          />
          {fieldErrors.slug ? (
            <span role="alert" className="mt-1.5 block text-xs text-rose-600 dark:text-rose-400">
              {fieldErrors.slug}
            </span>
          ) : null}
        </label>
      </div>

      <div className="mt-5 flex items-center justify-end gap-3">
        {error ? (
          <span role="alert" className="mr-auto text-xs text-rose-600 dark:text-rose-400">
            {error}
          </span>
        ) : null}
        {notice ? (
          <span className="mr-auto text-xs text-emerald-700 dark:text-emerald-400">{notice}</span>
        ) : null}
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}
