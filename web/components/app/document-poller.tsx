'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Document } from '@/lib/document-types';

// Polls an in-flight import (SPEC 5.3) via the same-origin BFF route until the
// API reports it left `importing`, then refreshes the server component so the
// rendered doc (or the failed state) takes over. Stops itself on completion.
export function DocumentPoller({ id }: { id: number }) {
  const router = useRouter();
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      try {
        const res = await fetch(`/api/bff/documents/${id}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        });

        if (res.ok) {
          const doc = (await res.json()) as Document;
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
  }, [id, router]);

  return (
    <div className="mt-8 flex items-center gap-3 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-500"
      />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Importing your document — this page updates itself when it&apos;s ready.
      </p>
    </div>
  );
}
