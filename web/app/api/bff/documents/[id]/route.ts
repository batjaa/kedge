import { NextRequest, NextResponse } from 'next/server';
import { forwardApiGet } from '@/lib/bff';
import type { Document } from '@/lib/document-types';

// BFF poll endpoint (SPEC 4, 5.3). The client poller on the document page hits
// this same-origin route while an import is in flight; it forwards the httpOnly
// session cookie to the API's GET /documents/{id} and relays status back, so the
// browser learns "importing → ready / failed" without touching the cookie or the
// API host directly. Non-200 upstreams pass their status straight through.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { status, data } = await forwardApiGet<Document>(
    request.headers,
    `/api/v1/documents/${encodeURIComponent(id)}`,
  );

  if (data) {
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: 'unavailable' }, { status });
}
