'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { startDemo } from '@/lib/demo-client';

// The anonymous SaaS home (SPEC §10.3, #25) — the PLG wedge, and the first thing
// a stranger sees. Paste a public URL, hit "Render it", and land on the rendered
// doc in seconds with zero signup. On success we navigate to the freshly-minted
// share link the API hands back (the visitor's capability to watch it render and
// come back to it). DESIGN.md tokens (Open Harbor light-first), no webfonts.
// Roles/labels are explicit so the M1 Playwright journey (#26) drives it cleanly.
export function DemoHome() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);

    const outcome = await startDemo(url.trim());

    if (outcome.ok) {
      // The share URL is absolute (API's FRONTEND_URL); navigate by its path so
      // the SPA transition stays same-origin.
      const path = safePath(outcome.shareUrl);
      router.push(path);
      return;
    }

    setError(
      outcome.kind === 'disabled'
        ? 'Demo mode is off on this instance. Sign in to import a document.'
        : outcome.kind === 'error'
          ? outcome.message
          : outcome.message,
    );
    setPending(false);
  }

  const fieldRing = error
    ? 'ring-rose-500/50 focus-visible:ring-rose-500'
    : 'ring-zinc-900/10 focus-visible:ring-emerald-500 dark:ring-white/10';

  return (
    <div className="flex min-h-screen flex-col bg-stone-50 dark:bg-zinc-900">
      <header className="flex h-14 items-center justify-between px-6">
        <BrandMark />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/signin"
            className="rounded-full bg-zinc-100 px-3.5 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 pb-24 pt-10">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
            Instant demo · no signup
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-5xl">
            See any spec, beautifully rendered.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
            Paste a link to a public GitHub file or a raw Markdown URL. Kedge
            imports it, renders it — TOC, dark mode, diagrams — and hands you a
            link to share. Claim it into an account any time in the next 48 hours.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          noValidate
          aria-label="Render a document"
          className="mt-10"
        >
          <label
            htmlFor="demo-url"
            className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            Document URL
          </label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              id="demo-url"
              name="url"
              type="url"
              inputMode="url"
              autoFocus
              placeholder="https://github.com/org/repo/blob/main/SPEC.md"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                if (error) setError(null);
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'demo-error' : 'demo-hint'}
              className={`w-full min-w-0 flex-1 rounded-xl bg-white px-4 py-3 text-sm text-zinc-900 ring-1 ring-inset placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 dark:bg-white/[.03] dark:text-white ${fieldRing}`}
            />
            <button
              type="submit"
              disabled={pending}
              className="shrink-0 rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
            >
              {pending ? 'Rendering…' : 'Render it'}
            </button>
          </div>

          {error ? (
            <p
              id="demo-error"
              role="alert"
              className="mt-2 text-sm text-rose-600 dark:text-rose-400"
            >
              {error}
            </p>
          ) : (
            <p id="demo-hint" className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
              Public GitHub blob links and raw <code>.md</code> / <code>.html</code>{' '}
              URLs. Private sources need an account.
            </p>
          )}
        </form>
      </main>
    </div>
  );
}

// Only ever navigate to a same-origin path parsed from the API's share URL —
// never trust it as a full destination.
function safePath(shareUrl: string): string {
  try {
    const parsed = new URL(shareUrl);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return shareUrl.startsWith('/') ? shareUrl : '/';
  }
}
