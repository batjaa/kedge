import { NextRequest, NextResponse } from 'next/server';
import { forwardApiGet } from '@/lib/bff';
import type { Project } from '@/lib/document-types';

interface ProjectCollection {
  data: Project[];
}

// BFF projects endpoint (SPEC §4, §16; M3.7 #104). The dashboard renders the
// projects rail server-side; this same-origin route is the client island's
// refresh path — re-read whenever a row settles/retries/refiles/imports (6A,
// generalized from the summary to the rail so per-project counts stay true as
// documents move) — forwarding the httpOnly session cookie to the API's
// GET /projects so the browser never touches the cookie or the API host
// directly. A non-200 upstream passes its status through; the client maps it to
// null and the rail keeps its last-good counts rather than blanking (A1).
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { status, data } = await forwardApiGet<ProjectCollection>(
    request.headers,
    '/api/v1/projects',
  );

  if (data) {
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: 'unavailable' }, { status });
}
