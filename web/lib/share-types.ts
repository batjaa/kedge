// Hand-written mirror of the API's share payloads (SPEC 10.2). OpenAPI/TS
// codegen is accepted debt (TODOS.md); until then this is the web↔api contract.
// Keep in sync with api/app/Http/Resources/V1/{Share,SharedDocument}Resource.php.

import type { Approval, DocumentFormat, DocumentStatus, DocumentVersion } from './document-types';

/** `link` only at M1; `email_restricted`/`workspace` arrive with M2 identity. */
export type ShareVisibility = 'link';

/** Derived lifecycle the UI badges. Anything but `active` is a dead link. */
export type ShareStatus = 'active' | 'revoked' | 'expired';

/** A share as its author manages it (list + create). */
export interface Share {
  id: number;
  visibility: ShareVisibility;
  status: ShareStatus;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string | null;
}

/**
 * The create response — a {@link Share} plus the one-time URL. `url` is present
 * only here, the sole moment the plaintext token exists; it is never returned
 * again.
 */
export interface CreatedShare extends Share {
  url: string;
}

/** GET /api/v1/documents/{id}/shares — the collection keeps the `data` envelope. */
export interface ShareList {
  data: Share[];
}

/**
 * The public read surface behind GET /shared/{token}. Deliberately lean: no
 * internal id, workspace, or source — the token grants exactly this and nothing
 * to traverse from.
 */
export interface SharedDocument {
  title: string;
  status: DocumentStatus;
  format: DocumentFormat;
  approvals?: Approval[];
  current_version?: DocumentVersion | null;
  /**
   * Demo-doc claim affordance (SPEC §10.3, #25). `claimable` is true only for a
   * demo doc; then — and only then — `document_id` and `expires_at` are present,
   * the id the "Claim this doc" flow needs to POST the claim after sign-up. An
   * ordinary share leaks no internal id.
   */
  claimable: boolean;
  document_id?: number;
  expires_at?: string | null;
  reviewer: {
    verified: boolean;
    id?: number | null;
    name?: string | null;
    email?: string | null;
  };
}

/** Why a share link is no longer active — drives the friendly "gone" page. */
export type ShareGoneReason = 'revoked' | 'expired' | 'unknown';
