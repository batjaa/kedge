import { headers } from 'next/headers';
import { forwardApiGet, forwardApiGetWithJson } from './bff';
import { applySectionQuery } from './document-list-live';
import type {
  Document,
  DocumentListPage,
  DocumentSectionQuery,
  DocumentVersion,
  DocumentVersionDiff,
} from './document-types';

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

export interface DocumentsReadResult {
  /** 200 with a page, 401/403 refused, 502 API down — `page` is null unless 200. */
  status: number;
  page: DocumentListPage | null;
}

/**
 * The workspace document list for the authenticated home (SPEC 11). Reads page
 * `page` (default 1) through the BFF cookie-forwarding path — the same seam as
 * {@link getDocument}. A non-200 leaves `page` null so the home can degrade the
 * list area alone without ever throwing. `project` scopes the read to one
 * project (an id) or the Unfiled bucket (`'unfiled'`) — the project page's
 * filter (M3.6). `section` layers the M3.10 (#118) source-grouping controls so a
 * repo section's / the Other-documents section's initial page is server-rendered
 * exactly as its client Load more will read it.
 */
export async function getDocuments(
  page = 1,
  project?: string | number,
  section?: DocumentSectionQuery,
): Promise<DocumentsReadResult> {
  const query = new URLSearchParams({ page: String(page) });
  if (project !== undefined && project !== '') query.set('project', String(project));
  applySectionQuery(query, section);

  const { status, data } = await forwardApiGet<DocumentListPage>(
    await headers(),
    `/api/v1/documents?${query.toString()}`,
  );
  return { status, page: data };
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

export interface DocumentVersionDiffReadResult {
  status: number;
  diff: DocumentVersionDiff | null;
}

export async function getDocumentVersionDiff(
  id: string,
  baseVersionId: string,
  targetVersionId: string,
): Promise<DocumentVersionDiffReadResult> {
  const { status, data } = await forwardApiGetWithJson<DocumentVersionDiff>(
    await headers(),
    `/api/v1/documents/${encodeURIComponent(id)}/versions/${encodeURIComponent(baseVersionId)}/diff/${encodeURIComponent(targetVersionId)}`,
    [200, 409],
  );

  return { status, diff: data };
}
