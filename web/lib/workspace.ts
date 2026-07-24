import { headers } from 'next/headers';
import { forwardApiGet } from './bff';
import type { WorkspaceSummary } from './document-types';

// Server-only. Reads the workspace dashboard summary by forwarding the incoming
// request's cookies to the API (the BFF read path, SPEC §4). Seeds the stats
// strip on the authenticated home; the same route the client island re-reads on
// settle (6A). A non-200 leaves `summary` null so the strip renders nothing and
// the documents list is never blocked (A1) — the same degrade contract as
// getDocuments.

export interface WorkspaceSummaryReadResult {
  /** 200 with the summary, 401/403 refused, 502 API down — null unless 200. */
  status: number;
  summary: WorkspaceSummary | null;
}

export async function getWorkspaceSummary(): Promise<WorkspaceSummaryReadResult> {
  const { status, data } = await forwardApiGet<WorkspaceSummary>(
    await headers(),
    '/api/v1/workspace/summary',
  );
  return { status, summary: data };
}
