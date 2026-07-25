// Hand-written mirror of the API's document payloads. OpenAPI/TS codegen is
// accepted debt (TODOS.md); until then this is the web↔api import contract.
// Keep in sync with api/app/Http/Resources/V1/{Document,DocumentVersion}Resource.php.

export type DocumentStatus = 'importing' | 'ready' | 'failed';
export type SyncStatus = 'ok' | 'failed';
export type LifecycleStatus = 'draft' | 'in_review' | 'approved' | 'superseded';
export type DocumentFormat = 'md' | 'mdx' | 'html';

/**
 * The dashboard's lifecycle filter chips (SPEC §16, M3.7; #103). Mirrors the
 * API's DocumentLifecycleFilter enum — the ONE place a chip value maps to its
 * predicate lives server-side (7A); this is only the wire value the list endpoint
 * accepts as `?lifecycle=`. `all` is the identity (no server filter); the three
 * editorial states a chip surfaces; and the `needs_attention` composite (failed
 * imports + orphaned threads + stale approvals). Superseded has no chip.
 */
export type DocumentLifecycleFilter =
  | 'all'
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'needs_attention';

/**
 * The authenticated dashboard's at-a-glance state (SPEC §16, M3.7): the stats
 * strip reads the totals, orphans, stale approvals, and imports; the lifecycle
 * filter chips (#103) read `documents.total` (All), the three lifecycle buckets,
 * and `documents.needs_attention` (Attention). Keep in sync with
 * api/app/Http/Resources/V1/WorkspaceSummaryResource.php (WorkspaceSummary).
 */
export interface WorkspaceSummary {
  documents: {
    total: number;
    importing: number;
    needs_attention: number;
    lifecycle: {
      draft: number;
      in_review: number;
      approved: number;
      superseded: number;
    };
  };
  threads: {
    open: number;
    orphaned: number;
  };
  approvals: {
    stale: number;
  };
}

/**
 * A project — a workspace container documents are grouped under (SPEC §16,
 * M3.6). Keep in sync with api/app/Http/Resources/V1/ProjectResource.php.
 */
export interface Project {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  /** Present when the list query counted it; omitted otherwise. */
  documents_count?: number;
  /**
   * The dashboard rail's per-project thread counts (#104) — present only on the
   * projects INDEX read, where each rides a shared-scope `withCount`
   * (Thread::scopeOpen / scopeOrphaned, 7A); the create/update payloads omit them.
   */
  open_threads_count?: number;
  orphaned_threads_count?: number;
  created_at: string | null;
}

/**
 * The lean project identity a document row / header carries for its chip and
 * selector — id + name only (the reserved M3.5 slot, filled at M3.6). Null is
 * Unfiled. Mirrors the `project` key on the document list + document resources.
 */
export interface ProjectRef {
  id: number;
  name: string;
}

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
  /**
   * Author-only manual content update for pasted/uploaded documents (#113). Pure
   * authorization; the review surface additionally requires source_type ===
   * 'upload' before showing the affordance.
   */
  update_content: boolean;
}

/** GET /api/v1/documents/{id} and the 202 from POST /api/v1/documents. */
export interface Document {
  id: number;
  title: string;
  status: DocumentStatus;
  format: DocumentFormat;
  source_type: string;
  source_url: string | null;
  /** Where the doc came from (M3.10) — the same descriptor the list row carries,
   *  so a live-prepended import row renders its provenance chip without a refetch. */
  source: DocumentSource;
  /** The tracked repo that imported it (#118 bucketing key); null if standalone. */
  tracked_repo_id: number | null;
  last_sync_status: SyncStatus;
  sync_error: string | null;
  lifecycle_status: LifecycleStatus;
  /** The document's project (M3.6); null is Unfiled. Present on show/update. */
  project?: ProjectRef | null;
  approvals?: Approval[];
  capabilities?: DocumentCapabilities;
  /** Present (non-null) once the import lands a version; absent while importing. */
  current_version?: DocumentVersion | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Where a document came from (M3.10, SPEC §11) — the display-ready provenance
 * descriptor the row chip renders. Derived server-side in ONE place
 * (api/app/Services/Documents/SourceDescriptor.php); the web renders it, never
 * re-parses a blob URL (§5.4). `kind` is always present; the rest ride along per
 * kind: `path` for a repo/github doc, `repo` ("owner/repo") for a standalone
 * GitHub import, `host` for a raw URL. An `upload` carries only its kind (the web
 * labels it "pasted"); a raw URL with no parseable host omits `host`.
 */
export interface DocumentSource {
  kind: 'repo' | 'github' | 'url' | 'upload';
  path?: string;
  repo?: string;
  host?: string;
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
  /** The document's project (M3.6) for the row chip; null is Unfiled. */
  project: ProjectRef | null;
  /** Where the doc came from (M3.10) — the provenance chip's source (§11). */
  source: DocumentSource;
  /** The tracked repo that imported it (#118 bucketing key); null if standalone. */
  tracked_repo_id: number | null;
  created_at: string | null;
}

/**
 * The project page's source-grouping controls (#118) layered on the ONE shared
 * list query. `trackedRepo` narrows to an attached repo's section;
 * `excludeTrackedRepos` carves the "Other documents" complement (repo id null or
 * not in the attached set); `order: 'path'` reads a repo section in repo-path
 * order (server-validated to require `trackedRepo`). All optional — omitted, the
 * read is the plain newest-first list. Kept web-side only: it maps to the API's
 * `tracked_repo` / `exclude_tracked_repos` / `order` query parameters.
 */
export interface DocumentSectionQuery {
  trackedRepo?: number;
  order?: 'path';
  excludeTrackedRepos?: number[];
}

/** Laravel paginator meta for the document list — drives "Load more" (#86). */
export interface DocumentListMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

/** Laravel's paginated resource-collection envelope for the document list. */
export interface DocumentListPage {
  data: DocumentListItem[];
  meta: DocumentListMeta;
}
