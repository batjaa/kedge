'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Catches a session that expires while the shell is already open. On tab focus
// it asks the BFF read endpoint whether we're still signed in — a same-origin
// request that carries the httpOnly cookie without JS ever reading it. A 401
// routes to sign-in with the friendly "expired" state, never a raw error.
// Event-driven (focus / visibility), so it is not a background poll.
export function SessionMonitor() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch('/api/bff/me', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!cancelled && res.status === 401) {
          const here = window.location.pathname + window.location.search;
          router.replace(`/signin?expired=1&next=${encodeURIComponent(here)}`);
        }
      } catch {
        // Network hiccup — leave the shell as-is; the next navigation re-checks.
      }
    }

    function onVisible() {
      if (document.visibilityState === 'visible') check();
    }

    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  return null;
}
