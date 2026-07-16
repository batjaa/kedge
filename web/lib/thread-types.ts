// Hand-written mirror of the API's thread/comment payloads. OpenAPI/TS codegen
// is accepted debt; keep in sync with api/app/Http/Resources/V1/*Thread*.

export type ThreadType = 'inline' | 'document';
export type ThreadStatus = 'open' | 'resolved';
export type CommentType = 'comment' | 'suggestion';
export type CommentClient = 'web' | 'mcp';
export type SuggestionStatus = 'pending' | 'accepted' | 'declined';
export type AnchorState = 'anchored' | 'relocated' | 'orphaned';

export interface ThreadAuthor {
  id: number;
  name: string;
}

export interface ThreadAnchor {
  id: number;
  document_version_id: number;
  exact: string;
  prefix: string | null;
  suffix: string | null;
  start: number;
  end: number;
  heading_path: string[];
  projection_version: string;
  state: AnchorState;
}

export interface ThreadComment {
  id: number;
  thread_id: number;
  author?: ThreadAuthor;
  type: CommentType;
  body_md: string | null;
  proposed_text: string | null;
  suggestion_status: SuggestionStatus | null;
  client: CommentClient;
  edited_at: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  can_edit: boolean;
  can_delete: boolean;
  can_fork: boolean;
  can_resolve_suggestion: boolean;
  created_at: string | null;
}

export interface ForkedIntoReference {
  thread_id: number;
  forked_from_comment_id: number | null;
}

export interface ReviewThread {
  id: number;
  document_id: number;
  type: ThreadType;
  status: ThreadStatus;
  forked_from_comment_id: number | null;
  forked_into_count: number;
  forked_into: ForkedIntoReference[];
  created_by: number;
  comment_count: number;
  latest_activity_at: string | null;
  anchor: ThreadAnchor | null;
  first_comment: ThreadComment | null;
  comments?: ThreadComment[];
  can_resolve: boolean;
  can_reopen: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface ThreadPage {
  data: ReviewThread[];
  links?: {
    next?: string | null;
  };
  meta?: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}

export interface ThreadAnchorPayload {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  heading_path: string[];
  projection_version: string;
}
