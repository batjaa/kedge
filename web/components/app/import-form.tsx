'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { importPaste, importUrl } from '@/lib/documents-client';
import type { Document } from '@/lib/document-types';

type Mode = 'url' | 'paste';

// The import entry point on the authenticated home shell. Two modes: paste a link
// to a spec (ticket #17) or paste the content directly (#22). Either way the API
// returns 202 with the new document. When `onImported` is supplied (the home's
// live list, 5A) the form stays put and hands the 202'd document up to prepend as
// an importing row; without it, it falls back to navigating to the doc page. A
// failed submit keeps its inline error and adds no row. DESIGN.md tokens. Chrome
// strings from the imports catalog (M3.9); API validation prose passes through.
const BUTTON_CLASS =
  'shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15';

export function ImportForm({
  onImported,
  projectId,
}: {
  onImported?: (doc: Document) => void;
  /** File the imported document under this project (a project page, M3.6). */
  projectId?: number;
}) {
  const t = useTranslations('imports');
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
        ? await importUrl(url.trim(), projectId)
        : await importPaste(content, title, projectId);

    if (outcome.ok) {
      if (onImported) {
        // Stay home (5A): hand the row up and reset for the next import, so a
        // reviewer can fire several and watch them all settle from this screen.
        onImported(outcome.document);
        setUrl('');
        setContent('');
        setTitle('');
        setPending(false);
        return;
      }
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
        aria-label={t('tabs.label')}
        className="inline-flex rounded-full bg-zinc-900/5 p-0.5 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:ring-white/10"
      >
        {(
          [
            ['url', t('tabs.url')],
            ['paste', t('tabs.paste')],
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
              {t('url.label')}
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <input
                id="import-url"
                name="url"
                type="url"
                inputMode="url"
                placeholder={t('url.placeholder')}
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
                {pending ? t('submitting') : t('submit')}
              </button>
            </div>
          </>
        ) : (
          <>
            <label
              htmlFor="import-title"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              {t('paste.titleLabel')}{' '}
              <span className="font-normal text-zinc-400 dark:text-zinc-500">
                {t('optional')}
              </span>
            </label>
            <input
              id="import-title"
              name="title"
              type="text"
              placeholder={t('paste.titlePlaceholder')}
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
              {t('paste.contentLabel')}
            </label>
            <textarea
              id="import-content"
              name="content"
              rows={8}
              placeholder={t('paste.contentPlaceholder')}
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
                {pending ? t('submitting') : t('submit')}
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
            {mode === 'url' ? t('url.hint') : t('paste.hint')}
          </p>
        )}
      </form>
    </div>
  );
}
