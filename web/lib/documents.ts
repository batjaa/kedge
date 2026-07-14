import { headers } from 'next/headers';
import { forwardApiGet } from './bff';
import type { Document } from './document-types';

// Server-only. Reads a document by forwarding the incoming request's cookies to
// the API's poll endpoint (the BFF read path, SPEC 4). Shared by the document
// server-component route and the /api/bff/documents/[id] poll handler, so both
// go through one cookie-forwarding implementation.

export interface DocumentReadResult {
  /** 200 ready, 401 unauthenticated, 403 forbidden, 404 missing, 502 API down. */
  status: number;
  document: Document | null;
}

export async function getDocument(id: string): Promise<DocumentReadResult> {
  const { status, data } = await forwardApiGet<Document>(
    await headers(),
    `/api/v1/documents/${encodeURIComponent(id)}`,
  );
  return { status, document: data };
}
