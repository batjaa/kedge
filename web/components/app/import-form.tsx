'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { importUrl } from '@/lib/documents-client';

// The paste-a-URL entry point on the authenticated home shell (ticket #17). On
// success the API returns 202 with the new document; we route to its page, which
// polls importing → ready. DESIGN.md tokens, matching the auth form.
export function ImportForm() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);

    const outcome = await importUrl(url.trim());

    if (outcome.ok) {
      router.push(`/documents/${outcome.document.id}`);
      return;
    }

    if (outcome.kind === 'validation') {
      setError(outcome.errors.url?.[0] ?? outcome.message);
    } else {
      setError(outcome.message);
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4">
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
          placeholder="https://raw.githubusercontent.com/org/repo/main/SPEC.md"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            if (error) setError(null);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'import-url-error' : undefined}
          className={`w-full min-w-0 flex-1 rounded-xl bg-white px-3.5 py-2 text-sm text-zinc-900 ring-1 ring-inset placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 dark:bg-white/[.03] dark:text-white ${
            error
              ? 'ring-rose-500/50 focus-visible:ring-rose-500'
              : 'ring-zinc-900/10 focus-visible:ring-emerald-500 dark:ring-white/10'
          }`}
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
        >
          {pending ? 'Importing…' : 'Import'}
        </button>
      </div>
      {error ? (
        <p
          id="import-url-error"
          role="alert"
          className="mt-1.5 text-xs text-rose-600 dark:text-rose-400"
        >
          {error}
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-500">
          Paste a link to a public Markdown file and Kedge renders it here.
        </p>
      )}
    </form>
  );
}
