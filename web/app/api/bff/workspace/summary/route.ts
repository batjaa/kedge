import { NextRequest, NextResponse } from 'next/server';
import { forwardApiGet } from '@/lib/bff';
import type { WorkspaceSummary } from '@/lib/document-types';

// BFF summary endpoint (SPEC §4, §16; M3.7). The dashboard renders the strip
// server-side; this same-origin route is the client island's refresh path —
// re-read whenever a row settles/retries/refiles (6A) — forwarding the httpOnly
// session cookie to the API's GET /workspace/summary so the browser never
// touches the cookie or the API host directly. A non-200 upstream passes its
// status straight through; the client maps it to null and the strip degrades to
// nothing (A1), never blocking the documents list.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { status, data } = await forwardApiGet<WorkspaceSummary>(
    request.headers,
    '/api/v1/workspace/summary',
  );

  if (data) {
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: 'unavailable' }, { status });
}
