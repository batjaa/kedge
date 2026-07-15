'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { publicApiBaseUrl } from '@/lib/config';
import type { SharedDocument } from '@/lib/share-types';

// Polls a still-importing demo doc on the public share surface (SPEC §10.3, #25)
// and refreshes the server component once it lands. Unlike the authenticated
// document poller, it hits the public `/shared/{token}` endpoint directly (the
// token is the whole capability — no cookies) and drives the browser hop with
// the client-visible API base. Stops itself the moment the doc leaves
// `importing`. Rendered only while importing, so a ready doc never polls.
export function SharedDocumentPoller({ token }: { token: string }) {
  const router = useRouter();
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      try {
        const res = await fetch(
          `${publicApiBaseUrl}/api/v1/shared/${encodeURIComponent(token)}`,
          { headers: { accept: 'application/json' }, cache: 'no-store' },
        );

        if (res.ok) {
          const doc = (await res.json()) as SharedDocument;
          if (doc.status !== 'importing') {
            stopped.current = true;
            router.refresh();
            return;
          }
        }
      } catch {
        // Transient network hiccup — keep polling.
      }

      if (!stopped.current) {
        timer = setTimeout(tick, 1500);
      }
    }

    timer = setTimeout(tick, 1500);
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [token, router]);

  return (
    <div className="mt-8 flex items-center gap-3 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-500"
      />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Rendering your document — this page updates itself when it&apos;s ready.
      </p>
    </div>
  );
}
