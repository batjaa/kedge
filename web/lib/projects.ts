import { headers } from 'next/headers';
import { forwardApiGet } from './bff';
import type { Project } from './document-types';

// Server-only. Reads the workspace's projects by forwarding the incoming
// request's cookies to the API (the BFF read path, SPEC §4). Seeds the home's
// grouping + assignment selectors and the project page's description header.

export interface ProjectsReadResult {
  /** 200 with the list, 401/403 refused, 502 API down — `projects` empty unless 200. */
  status: number;
  projects: Project[];
}

interface ProjectCollection {
  data: Project[];
}

export async function getProjects(): Promise<ProjectsReadResult> {
  const { status, data } = await forwardApiGet<ProjectCollection>(
    await headers(),
    '/api/v1/projects',
  );
  return { status, projects: data?.data ?? [] };
}
