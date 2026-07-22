// The document-row project chip's assignment orchestration, lifted out of the row
// as a pure core so its success / failure / rejected-fetch behaviour tests without a
// DOM — the same functional-core / imperative-shell split as tracked-repo-actions.ts
// and import-retry.ts. The chip injects the client call and its React setters; tests
// inject stubs.

import type { AssignProjectOutcome } from './projects-client';
import type { Document } from './document-types';

/**
 * Re-file a document under a project (or clear it to Unfiled). Guards a no-op (the
 * same project) and a double-press, then surfaces the outcome: on success the island
 * regroups via `onAssigned`; on a mapped failure OR a rejected fetch a message
 * surfaces and the document is left unmoved, so the chip's controlled `<select>`
 * reverts to its real project. `pending` always clears — a network blip can never
 * wedge the select disabled.
 */
export async function runProjectAssign({
  documentId,
  nextId,
  currentId,
  pending,
  assign,
  setPending,
  setError,
  onAssigned,
}: {
  documentId: number;
  nextId: number | null;
  currentId: number | null;
  pending: boolean;
  assign: (id: number, projectId: number | null) => Promise<AssignProjectOutcome>;
  setPending: (value: boolean) => void;
  setError: (message: string | null) => void;
  onAssigned: (doc: Document) => void;
}): Promise<void> {
  if (pending || nextId === currentId) return;

  setPending(true);
  setError(null);

  try {
    const outcome = await assign(documentId, nextId);
    if (outcome.ok) {
      onAssigned(outcome.document);
    } else {
      setError(outcome.message);
    }
  } catch {
    setError('Could not move the document. Please try again.');
  } finally {
    setPending(false);
  }
}
