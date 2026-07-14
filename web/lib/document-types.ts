// Hand-written mirror of the API's document payloads. OpenAPI/TS codegen is
// accepted debt (TODOS.md); until then this is the web↔api import contract.
// Keep in sync with api/app/Http/Resources/V1/{Document,DocumentVersion}Resource.php.

export type DocumentStatus = 'importing' | 'ready' | 'failed';
export type SyncStatus = 'ok' | 'failed';
export type LifecycleStatus = 'draft' | 'in_review' | 'approved' | 'superseded';
export type DocumentFormat = 'md' | 'mdx' | 'html';

export interface DocumentVersion {
  id: number;
  content_hash: string;
  /** content_normalized — the markdown the reading surface renders. */
  content: string;
  source_version: string | null;
  synced_at: string | null;
}

/** GET /api/v1/documents/{id} and the 202 from POST /api/v1/documents. */
export interface Document {
  id: number;
  title: string;
  status: DocumentStatus;
  format: DocumentFormat;
  source_type: string;
  source_url: string | null;
  last_sync_status: SyncStatus;
  sync_error: string | null;
  lifecycle_status: LifecycleStatus;
  /** Present (non-null) once the import lands a version; absent while importing. */
  current_version?: DocumentVersion | null;
  created_at: string | null;
  updated_at: string | null;
}
