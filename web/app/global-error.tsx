'use client';

import './global.css';

// Root-level error boundary. When rendering the root layout itself fails, Next
// unmounts the whole tree — RootProvider (theme + Fumadocs context) included —
// and renders this in its place, so it must be fully self-contained: its own
// <html>/<body>, zero app providers, zero context consumers.
//
// Next prerenders this route (/_global-error) at build time. Without an explicit
// page here Next synthesizes its default one through the layout-router code
// path, which reads LayoutRouterContext during the standalone prerender and
// crashes `next build` (Cannot read properties of null (reading 'useContext')).
// A provider-free page renders in isolation and prerenders cleanly.
//
// Dark-first per DESIGN.md; styled with the standard button recipes. It hard-
// codes the dark class because next-themes is unavailable this far outside the
// provider tree.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body className="flex min-h-screen flex-col items-center justify-center bg-zinc-900 px-6 text-center antialiased">
        <div className="w-full max-w-md">
          <span
            aria-hidden="true"
            className="mx-auto flex h-9 w-9 items-end justify-end rounded-md bg-emerald-400/90 p-1.5"
          >
            <span className="h-3 w-2 rounded-sm bg-zinc-900" />
          </span>
          <h1 className="mt-6 text-lg font-semibold text-white">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Kedge hit an unexpected error while loading this page. Try again, or
            head back home.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-full bg-emerald-400/10 px-3.5 py-1.5 text-sm font-medium text-emerald-400 ring-1 ring-inset ring-emerald-400/20 hover:bg-emerald-400/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              Try again
            </button>
            <a
              href="/"
              className="rounded-full bg-white/5 px-3.5 py-1.5 text-sm font-medium text-zinc-300 ring-1 ring-inset ring-white/10 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              Go home
            </a>
          </div>
          {error?.digest && (
            <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-zinc-500">
              Error {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
