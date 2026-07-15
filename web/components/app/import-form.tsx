'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { importPaste, importUrl } from '@/lib/documents-client';

type Mode = 'url' | 'paste';

// The import entry point on the authenticated home shell. Two modes: paste a link
// to a spec (ticket #17) or paste the content directly (#22). Either way the API
// returns 202 with the new document; we route to its page, which polls
// importing → ready. DESIGN.md tokens, matching the auth form.
const BUTTON_CLASS =
  'shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15';

export function ImportForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('url');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);

    const outcome =
      mode === 'url'
        ? await importUrl(url.trim())
        : await importPaste(content, title);

    if (outcome.ok) {
      router.push(`/documents/${outcome.document.id}`);
      return;
    }

    if (outcome.kind === 'validation') {
      setError(
        outcome.errors.url?.[0] ??
          outcome.errors.content?.[0] ??
          outcome.errors.title?.[0] ??
          outcome.message,
      );
    } else {
      setError(outcome.message);
    }
    setPending(false);
  }

  const fieldRing = error
    ? 'ring-rose-500/50 focus-visible:ring-rose-500'
    : 'ring-zinc-900/10 focus-visible:ring-emerald-500 dark:ring-white/10';
  const describedBy = error ? 'import-error' : undefined;

  return (
    <div className="mt-4">
      <div
        role="tablist"
        aria-label="Import source"
        className="inline-flex rounded-full bg-zinc-900/5 p-0.5 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:ring-white/10"
      >
        {(
          [
            ['url', 'Paste a URL'],
            ['paste', 'Paste content'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => switchMode(value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              mode === value
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-white/10 dark:text-white'
                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-3">
        {mode === 'url' ? (
          <>
            <label
              htmlFor="import-url"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Document URL
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <input
                id="import-url"
                name="url"
                type="url"
                inputMode="url"
                placeholder="https://github.com/org/repo/blob/main/SPEC.md"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  if (error) setError(null);
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                className={`w-full min-w-0 flex-1 rounded-xl bg-white px-3.5 py-2 text-sm text-zinc-900 ring-1 ring-inset placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 dark:bg-white/[.03] dark:text-white ${fieldRing}`}
              />
              <button type="submit" disabled={pending} className={BUTTON_CLASS}>
                {pending ? 'Importing…' : 'Import'}
              </button>
            </div>
          </>
        ) : (
          <>
            <label
              htmlFor="import-title"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Title{' '}
              <span className="font-normal text-zinc-400 dark:text-zinc-500">
                — optional
              </span>
            </label>
            <input
              id="import-title"
              name="title"
              type="text"
              placeholder="Untitled document"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (error) setError(null);
              }}
              aria-describedby={describedBy}
              className="mt-1.5 w-full rounded-xl bg-white px-3.5 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-900/10 placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-white/10"
            />

            <label
              htmlFor="import-content"
              className="mt-3 block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Content
            </label>
            <textarea
              id="import-content"
              name="content"
              rows={8}
              placeholder={'# Paste your Markdown here\n\nKedge renders it — no link needed.'}
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                if (error) setError(null);
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              className={`mt-1.5 block w-full resize-y rounded-xl bg-white px-3.5 py-2 font-mono text-sm text-zinc-900 ring-1 ring-inset placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 dark:bg-white/[.03] dark:text-white ${fieldRing}`}
            />
            <div className="mt-2 flex justify-end">
              <button type="submit" disabled={pending} className={BUTTON_CLASS}>
                {pending ? 'Importing…' : 'Import'}
              </button>
            </div>
          </>
        )}

        {error ? (
          <p
            id="import-error"
            role="alert"
            className="mt-1.5 text-xs text-rose-600 dark:text-rose-400"
          >
            {error}
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-500">
            {mode === 'url'
              ? 'Paste a link to a public Markdown file or a GitHub blob URL, and Kedge renders it here.'
              : 'Paste Markdown content directly and Kedge renders it here.'}
          </p>
        )}
      </form>
    </div>
  );
}
