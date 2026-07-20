import { headers } from 'next/headers';
import { forwardApiGet } from './bff';
import type { Document, DocumentVersion } from './document-types';

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

export interface DocumentVersionsReadResult {
  status: number;
  versions: DocumentVersion[];
}

interface DocumentVersionCollection {
  data: DocumentVersion[];
}

export async function getDocumentVersions(id: string): Promise<DocumentVersionsReadResult> {
  const { status, data } = await forwardApiGet<DocumentVersionCollection>(
    await headers(),
    `/api/v1/documents/${encodeURIComponent(id)}/versions`,
  );

  return { status, versions: data?.data ?? [] };
}

export interface DocumentVersionReadResult {
  status: number;
  version: DocumentVersion | null;
}

export async function getDocumentVersion(id: string, versionId: string): Promise<DocumentVersionReadResult> {
  const { status, data } = await forwardApiGet<DocumentVersion>(
    await headers(),
    `/api/v1/documents/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`,
  );

  return { status, version: data };
}
