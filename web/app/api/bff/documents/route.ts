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
  const { status, data } = await forwardApiGet<DocumentListPage>(
    request.headers,
    `/api/v1/documents?page=${encodeURIComponent(page)}`,
  );

  if (data) {
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: 'unavailable' }, { status });
}
