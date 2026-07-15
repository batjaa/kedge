'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { claimDocument } from '@/lib/demo-client';

// Completes a demo-doc claim right after sign-up (SPEC §10.3, #25). The "Claim
// this doc" CTA sends the new user here via /signup?next=/documents/{id}?claim=1;
// the document page hands off to this component instead of trying to read the doc
// (which still lives in the system workspace and would 404 for the new owner).
// It POSTs the claim, then lands on the clean doc URL — now owned. If the doc was
// already claimed (a double-submit, or someone beat them to it), it still routes
// to the doc and lets the normal guard decide what to show.
export function DocumentClaim({ id }: { id: number }) {
  const router = useRouter();
  const ran = useRef(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (ran.current) return; // StrictMode double-invoke guard
    ran.current = true;

    (async () => {
      const outcome = await claimDocument(id);

      if (outcome.ok || outcome.kind === 'forbidden') {
        // Owned now (or already owned / taken) — drop the claim intent and let the
        // document route render authoritatively.
        router.replace(`/documents/${id}`);
        router.refresh();
        return;
      }

      setFailed(outcome.message);
    })();
  }, [id, router]);

  if (failed) {
    return (
      <div className="mt-8 rounded-2xl bg-white p-8 text-center ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
          Couldn&apos;t claim this document
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {failed}
        </p>
        <Link
          href={`/documents/${id}?claim=1`}
          className="mt-4 inline-block text-sm font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
        >
          Try again
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 flex items-center gap-3 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-500"
      />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Claiming this document into your workspace…
      </p>
    </div>
  );
}
