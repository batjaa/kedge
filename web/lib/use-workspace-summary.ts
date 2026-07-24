'use client';

import { useCallback, useRef, useState } from 'react';
import { createLatestWinsGate, nextSummary, readWorkspaceSummary } from './workspace-summary';
import type { WorkspaceSummary } from './document-types';

// The dashboard stats strip's state (SPEC §16, M3.7; decisions 6A + A1). Seeded
// with the server-rendered summary; `refresh` re-reads through the BFF and is
// wired to the live list's import/settle/retry/refile callbacks (6A) so counts
// stay true while imports settle — no new poll loop. A failed initial read seeds
// `null` and the strip renders nothing (A1); a failed *refresh* keeps the
// last-good counts (see nextSummary). Overlapping refreshes are gated
// latest-wins so a slow older read can never overwrite a newer one.

export interface WorkspaceSummaryState {
  summary: WorkspaceSummary | null;
  refresh: () => void;
}

export function useWorkspaceSummary(
  initialSummary: WorkspaceSummary | null,
): WorkspaceSummaryState {
  const [summary, setSummary] = useState<WorkspaceSummary | null>(initialSummary);
  const gateRef = useRef(createLatestWinsGate());

  const refresh = useCallback(() => {
    const token = gateRef.current.begin();
    void readWorkspaceSummary().then((fetched) => {
      // Drop a stale (out-of-order) response: only the newest refresh writes.
      if (!gateRef.current.isCurrent(token)) return;
      setSummary((current) => nextSummary(current, fetched));
    });
  }, []);

  return { summary, refresh };
}
