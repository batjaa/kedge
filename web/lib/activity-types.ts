// The dashboard Recent-activity feed's wire shape (SPEC §16, M3.8 #111). Mirrors
// api/app/Http/Resources/V1/ActivityEventResource.php (the 3A allowlist
// projection) — hand-kept in sync with the PHP side (TS/PHP duplication is
// accepted debt until OpenAPI codegen — TODOS). Only the fields the feed is
// allowed to surface exist here: there is deliberately no `ip` and no raw `meta`.

export type ActivityEventType =
  | 'comment.created'
  | 'suggestion.accepted'
  | 'suggestion.declined'
  | 'approval.given'
  | 'approval.gone_stale'
  | 'reanchor.completed'
  | 'document.imported'
  | 'document.import_failed'
  | 'workspace.renamed';

/** Where a row points. Resolved server-side from the audit subject purely to
 *  build the link (2A); a deleted target is `null`, and the row renders its
 *  sentence from the snapshot with the link dropped. */
export type ActivityTarget = { type: 'document'; id: number } | { type: 'workspace' };

/** The allowlisted snapshot fields — all optional; the sentence for each type
 *  reads only the ones its case projects (see ActivityFeedEvent::contextFor). */
export interface ActivityContext {
  document_title?: string;
  section?: string;
  anchored?: number;
  relocated?: number;
  orphaned?: number;
  reason?: string;
  count?: number;
  workspace_name?: string;
}

export interface ActivityEvent {
  id: number;
  type: ActivityEventType;
  /** Name only — the web derives the avatar initials; a null name is a system row. */
  actor: { name: string | null };
  context: ActivityContext;
  target: ActivityTarget | null;
  created_at: string;
}

/** The paginated envelope the endpoint returns; the panel consumes page 1's `data`. */
export interface ActivityFeedResponse {
  data: ActivityEvent[];
}
