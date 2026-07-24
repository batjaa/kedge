'use client';

import { useCallback, useState } from 'react';
import { nextSummary, readWorkspaceSummary } from './workspace-summary';
import type { WorkspaceSummary } from './document-types';

// The dashboard stats strip's state (SPEC §16, M3.7; decisions 6A + A1). Seeded
// with the server-rendered summary; `refresh` re-reads through the BFF and is
// wired to the live list's settle/retry/refile callbacks (6A) so counts stay
// true while imports settle — no new poll loop. A failed initial read seeds
// `null` and the strip renders nothing (A1); a failed *refresh* keeps the
// last-good counts (see nextSummary).

export interface WorkspaceSummaryState {
  summary: WorkspaceSummary | null;
  refresh: () => void;
}

export function useWorkspaceSummary(
  initialSummary: WorkspaceSummary | null,
): WorkspaceSummaryState {
  const [summary, setSummary] = useState<WorkspaceSummary | null>(initialSummary);

  const refresh = useCallback(() => {
    void readWorkspaceSummary().then((fetched) =>
      setSummary((current) => nextSummary(current, fetched)),
    );
  }, []);

  return { summary, refresh };
}
