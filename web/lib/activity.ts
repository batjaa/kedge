import { headers } from 'next/headers';
import { forwardApiGet } from './bff';
import type { ActivityEvent, ActivityFeedResponse } from './activity-types';

// Server-only. Reads the workspace's Recent-activity feed by forwarding the
// incoming request's cookies to the API (the BFF read path, SPEC §4). Seeds the
// dashboard panel on page load; there is NO client refresh path (no polling — M5
// owns liveness), so unlike the summary this has no same-origin BFF route.
//
// Degradation (A1): a non-200 (or unreachable) read leaves `events` null and the
// panel renders NOTHING behind the existing degraded banner — the dashboard is
// never blocked. A 200 with no rows is a real empty page (`[]`) and drives the
// designed empty state, which is a distinct thing from an outage.

export interface WorkspaceActivityReadResult {
  /** 200 with the page, 401/403 refused, 502 API down — events null unless 200. */
  status: number;
  /** null = degraded (A1); [] = an empty workspace's designed empty state. */
  events: ActivityEvent[] | null;
}

export async function getWorkspaceActivity(): Promise<WorkspaceActivityReadResult> {
  const { status, data } = await forwardApiGet<ActivityFeedResponse>(
    await headers(),
    '/api/v1/workspace/activity',
  );

  return { status, events: data?.data ?? null };
}
