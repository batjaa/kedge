import { NextRequest, NextResponse } from 'next/server';
import { forwardApiGet } from '@/lib/bff';
import type { DocumentListPage } from '@/lib/document-types';

// BFF list endpoint (SPEC 4, 11). The home renders page 1 server-side; this
// same-origin route is the client island's read path for "Load more" (#86) and
// the prepend-on-submit refresh (#85) — it forwards the httpOnly session cookie
// to the API's GET /documents and relays the paginated page back, so the browser
// never touches the cookie or the API host directly. Non-200 upstreams pass
// their status straight through, matching the per-document poll route.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const page = request.nextUrl.searchParams.get('page') ?? '1';
  const query = new URLSearchParams({ page });
  // Forward the reserved `?project=` filter (id or `unfiled`) so a project
  // page's Load more stays scoped to its project (M3.6).
  const project = request.nextUrl.searchParams.get('project');
  if (project) query.set('project', project);
  // Forward the dashboard lifecycle filter chip (#103) so the server narrows the
  // whole set — the API validates the value and applies the shared predicate (7A).
  const lifecycle = request.nextUrl.searchParams.get('lifecycle');
  if (lifecycle) query.set('lifecycle', lifecycle);
  // Forward the project page's source-grouping controls (#118): a repo section's
  // tracked-repo filter + path order, or the Other-documents exclusion set. The
  // API validates each and scopes them to the caller's workspace.
  for (const param of ['tracked_repo', 'order', 'exclude_tracked_repos'] as const) {
    const value = request.nextUrl.searchParams.get(param);
    if (value) query.set(param, value);
  }

  const { status, data } = await forwardApiGet<DocumentListPage>(
    request.headers,
    `/api/v1/documents?${query.toString()}`,
  );

  if (data) {
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: 'unavailable' }, { status });
}
