// Hand-written mirror of the API's document payloads. OpenAPI/TS codegen is
// accepted debt (TODOS.md); until then this is the web↔api import contract.
// Keep in sync with api/app/Http/Resources/V1/{Document,DocumentVersion}Resource.php.

export type DocumentStatus = 'importing' | 'ready' | 'failed';
export type SyncStatus = 'ok' | 'failed';
export type LifecycleStatus = 'draft' | 'in_review' | 'approved' | 'superseded';
export type DocumentFormat = 'md' | 'mdx' | 'html';

export interface Approval {
  id: number;
  user: {
    id: number;
    name: string | null;
  };
  document_version_id: number;
  version_label: string;
  stale: boolean;
  created_at: string | null;
}

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
  ordinal: number | null;
  kind?: 'mainline' | 'candidate';
  parent_version_id?: number | null;
  content_hash: string;
  /** content_normalized — the markdown/MDX the reading surface renders. */
  content: string;
  /** What didn't survive normalization; always present, empty when clean. */
  import_warnings: ImportWarning[];
  /**
   * Authenticated document reads include the stored projection substrate for
   * anchor capture. Public share reads omit these fields.
   */
  plain_text?: string | null;
  projection_version?: string | null;
  /**
   * Whether this version's MDX compiled (SPEC §6.1). `null` for non-MDX formats
   * (not applicable); `false` routes the doc to the plain-markdown fallback +
   * banner. Set by the projection endpoint's real compile validation (#20).
   */
  mdx_ok: boolean | null;
  source_version: string | null;
  synced_at: string | null;
}

export interface VersionDiffVersion {
  id: number;
  ordinal: number | null;
  label: string;
  synced_at: string | null;
  projection_version: string | null;
  plain_text?: string | null;
}

export interface DocumentVersionDiff {
  comparable: boolean;
  message?: string;
  document: {
    id: number;
    title: string;
  };
  current_version: VersionDiffVersion | null;
  versions: {
    a: VersionDiffVersion;
    b: VersionDiffVersion;
  };
  approvals: Approval[];
}

export interface DocumentCapabilities {
  update_lifecycle: boolean;
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
  approvals?: Approval[];
  capabilities?: DocumentCapabilities;
  /** Present (non-null) once the import lands a version; absent while importing. */
  current_version?: DocumentVersion | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * One row of the workspace document list — GET /api/v1/documents (SPEC 11).
 * Deliberately lean: navigation fields only, no version content and no
 * capabilities block (decision 6A). Keep in sync with
 * api/app/Http/Resources/V1/DocumentListResource.php.
 */
export interface DocumentListItem {
  id: number;
  title: string;
  status: DocumentStatus;
  last_sync_status: SyncStatus;
  sync_error: string | null;
  lifecycle_status: LifecycleStatus;
  open_threads_count: number;
  /** The current version's sync time; null while a doc is still importing. */
  synced_at: string | null;
  created_at: string | null;
}

/** Laravel's paginated resource-collection envelope for the document list. */
export interface DocumentListPage {
  data: DocumentListItem[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}
