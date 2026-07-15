// Hand-written mirror of the API's document payloads. OpenAPI/TS codegen is
// accepted debt (TODOS.md); until then this is the web↔api import contract.
// Keep in sync with api/app/Http/Resources/V1/{Document,DocumentVersion}Resource.php.

export type DocumentStatus = 'importing' | 'ready' | 'failed';
export type SyncStatus = 'ok' | 'failed';
export type LifecycleStatus = 'draft' | 'in_review' | 'approved' | 'superseded';
export type DocumentFormat = 'md' | 'mdx' | 'html';

/**
 * One thing that didn't survive normalization of this version (SPEC 5.2) — a
 * failed image fetch, a degraded HTML conversion. `message` is author-facing;
 * `type` is a stable machine key. Mirrors
 * api/app/Services/Import/Normalization/ImportWarning.php.
 */
export interface ImportWarning {
  type: string;
  message: string;
}

export interface DocumentVersion {
  id: number;
  content_hash: string;
  /** content_normalized — the markdown/MDX the reading surface renders. */
  content: string;
  /** What didn't survive normalization; always present, empty when clean. */
  import_warnings: ImportWarning[];
  /**
   * Whether this version's MDX compiled (SPEC §6.1). `null` for non-MDX formats
   * (not applicable); `false` routes the doc to the plain-markdown fallback +
   * banner. Set by the projection endpoint's real compile validation (#20).
   */
  mdx_ok: boolean | null;
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
