'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

// Header theme toggle (DESIGN.md: "Theme toggle in the header"). Uses the
// next-themes context the fumadocs RootProvider already sets up, so the choice
// persists across every surface — docs, auth, shell — and across reloads.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Theme is only known after hydration; render a stable placeholder until then.
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-zinc-400 dark:ring-white/10 dark:hover:bg-white/5"
    >
      {mounted && !isDark ? (
        // Sun (currently light → offer dark)
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <circle cx="12" cy="12" r="4" />
          <path
            strokeLinecap="round"
            d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
          />
        </svg>
      ) : (
        // Moon (default / dark → offer light)
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.7 14.4A9 9 0 1 1 9.6 2.3a7 7 0 1 0 12.1 12.1Z"
          />
        </svg>
      )}
    </button>
  );
}
