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
// Open Harbor light-first (DESIGN.md): defaults to the warm light register.
// next-themes is unavailable this far outside the provider tree, so a tiny inline
// script re-applies a persisted dark choice before paint — the only way to keep
// the toggle honest on a surface with no React context.
const THEME_INIT = `try{var t=localStorage.getItem('theme');if(t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="flex min-h-screen flex-col items-center justify-center bg-stone-50 px-6 text-center antialiased dark:bg-zinc-900">
        <div className="w-full max-w-md">
          <span
            aria-hidden="true"
            className="mx-auto flex h-9 w-9 items-end justify-end rounded-md bg-emerald-600 p-1.5 dark:bg-emerald-400/90"
          >
            <span className="h-3 w-2 rounded-sm bg-white dark:bg-zinc-900" />
          </span>
          <h1 className="mt-6 text-lg font-semibold text-zinc-900 dark:text-white">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Kedge hit an unexpected error while loading this page. Try again, or
            head back home.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-full bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15 dark:focus-visible:ring-emerald-400"
            >
              Try again
            </button>
            <a
              href="/"
              className="rounded-full bg-zinc-100 px-3.5 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10 dark:focus-visible:ring-emerald-400"
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
