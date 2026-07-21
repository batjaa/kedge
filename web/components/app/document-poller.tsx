'use client';

import { useRouter } from 'next/navigation';
import { usePollUntilSettled } from '@/lib/use-poll-until-settled';
import type { Document } from '@/lib/document-types';

// Polls an in-flight import (SPEC 5.3) via the same-origin BFF route until the
// API reports it left `importing`, then refreshes the server component so the
// rendered doc (or the failed state) takes over. Stops itself on completion. The
// timer/settle/cleanup skeleton and the poll cadence live in the shared
// usePollUntilSettled hook (12A); this owns only the read and the settle action.
export function DocumentPoller({ id }: { id: number }) {
  const router = useRouter();

  usePollUntilSettled({
    // A non-ok response or a thrown fetch is a transient hiccup → null keeps the
    // loop alive; a doc that has left `importing` is the settle payload.
    poll: async (): Promise<Document | null> => {
      try {
        const res = await fetch(`/api/bff/documents/${id}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        });

        if (res.ok) {
          const doc = (await res.json()) as Document;
          if (doc.status !== 'importing') return doc;
        }
      } catch {
        // Transient network hiccup — keep polling.
      }

      return null;
    },
    onSettled: () => router.refresh(),
    deps: [id, router],
  });

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
