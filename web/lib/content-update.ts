// The pasted-content update orchestration (#113), extracted as a pure async unit
// so the update surface's behaviour is tested without a DOM — the same seam
// discipline as lib/import-retry.ts. It POSTs the new body, then polls the shared
// version-settle model (lib/resync-polling.ts) and maps the outcome to one of a
// small, exhaustive set of results the dialog renders. It performs no DOM or
// router work itself: the refresh side effects are injected so the caller owns
// them (and the test can assert them).

import type { ImportOutcome } from './documents-client';
import type { ResyncPollResult } from './resync-polling';

export type ContentUpdateResult =
  // The pasted body failed validation (a size-cap 422 or a missing body) — the
  // dialog keeps the draft and shows this in place.
  | { status: 'validation'; message: string }
  // A transport/other failure starting the request.
  | { status: 'error'; message: string }
  // The queued update ran but the sync failed — the current version is untouched
  // (SPEC §5.3); `message` is the server's "showing last good version" copy.
  | { status: 'failed'; message: string }
  // A new version landed and the surface has been refreshed.
  | { status: 'advanced' }
  // The body was identical to the current version, so the pipeline deduped and no
  // new version was minted — honest feedback, never a phantom success.
  | { status: 'unchanged'; message: string };

const UNCHANGED_MESSAGE = 'No new version — the content is identical to the current version.';

export async function runContentUpdate({
  documentId,
  content,
  title,
  startingVersionLabel,
  update,
  waitForCompletion,
  onAdvanced,
  onServerRefresh,
}: {
  documentId: number;
  content: string;
  title: string;
  startingVersionLabel: string | null | undefined;
  update: (id: number, content: string, title?: string) => Promise<ImportOutcome>;
  waitForCompletion: (
    id: number,
    label: string | null | undefined,
  ) => Promise<ResyncPollResult>;
  /** Refresh threads + server props after a successful flip. */
  onAdvanced: () => Promise<void>;
  /** Re-read server props after a failed or no-op update. */
  onServerRefresh: () => void;
}): Promise<ContentUpdateResult> {
  const outcome = await update(documentId, content, title);

  if (!outcome.ok) {
    if (outcome.kind === 'validation') {
      return {
        status: 'validation',
        message:
          outcome.errors.content?.[0] ??
          outcome.errors.title?.[0] ??
          outcome.message,
      };
    }

    return { status: 'error', message: outcome.message };
  }

  const result = await waitForCompletion(documentId, startingVersionLabel);

  if (result.status === 'failed') {
    onServerRefresh();
    return { status: 'failed', message: result.message };
  }

  if (result.status === 'advanced') {
    await onAdvanced();
    return { status: 'advanced' };
  }

  // 'timeout' with no failure: a deduped, identical-content update. Re-read the
  // server props (nothing changed, but it clears any stale sync banner) and tell
  // the author plainly.
  onServerRefresh();
  return { status: 'unchanged', message: UNCHANGED_MESSAGE };
}
