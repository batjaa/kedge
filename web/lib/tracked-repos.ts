import { headers } from 'next/headers';
import { forwardApiGet } from './bff';
import type { TrackedRepo } from './tracked-repo-scan';

// Server-only. Reads a project's tracked repos by forwarding the incoming
// request's cookies to the API (the BFF read path, SPEC §4). Seeds the project
// page's tracked-repo panel so each record's state + last report renders on load;
// any record still `running` is then polled client-side.

export interface TrackedReposReadResult {
  /** 200 with the list, 401/403 refused, 502 API down — empty unless 200. */
  status: number;
  trackedRepos: TrackedRepo[];
}

interface TrackedRepoCollection {
  data: TrackedRepo[];
}

export async function getTrackedRepos(projectId: number): Promise<TrackedReposReadResult> {
  const { status, data } = await forwardApiGet<TrackedRepoCollection>(
    await headers(),
    `/api/v1/tracked-repos?project=${projectId}`,
  );
  return { status, trackedRepos: data?.data ?? [] };
}
