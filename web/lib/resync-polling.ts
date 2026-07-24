// The client-side wait for a queued version pipeline to settle — shared by the
// URL re-sync affordance and the pasted-content update (#113), which both
// dispatch the same ResyncDocumentJob and then poll the document until its
// current version advances, the sync fails, or the window elapses. Extracted from
// the review surface so both triggers observe an identical, tested settle model.

import { readDocument } from './documents-client';
import { versionLabel as displayVersionLabel } from './version-label';
import type { Document } from './document-types';

export const RESYNC_POLL_INTERVAL_MS = 1500;
export const RESYNC_POLL_ATTEMPTS = 12;

export type ResyncPollResult =
  | { status: 'advanced' }
  | { status: 'failed'; message: string }
  | { status: 'timeout' };

/**
 * Poll the document until its current version label differs from the one that was
 * current when the request started (a new version landed → 'advanced'), the sync
 * reports failure ('failed', carrying the server copy), or the attempt budget is
 * exhausted ('timeout'). For a content update a 'timeout' with no failure is the
 * honest "content was identical — no new version" signal, since a deduped update
 * never advances the label.
 */
export async function waitForResyncCompletion(
  documentId: number,
  startingVersionLabel: string | null | undefined,
): Promise<ResyncPollResult> {
  for (let attempt = 0; attempt < RESYNC_POLL_ATTEMPTS; attempt++) {
    await delay(RESYNC_POLL_INTERVAL_MS);

    const document = await readDocument(documentId).catch(() => null);
    if (!document) continue;

    if (document.last_sync_status === 'failed') {
      return {
        status: 'failed',
        message: document.sync_error ?? 'Sync failed. Showing last good version.',
      };
    }

    const currentVersionLabel = documentVersionLabel(document);
    if (currentVersionLabel !== null && currentVersionLabel !== (startingVersionLabel ?? null)) {
      return { status: 'advanced' };
    }
  }

  return { status: 'timeout' };
}

export async function refreshSurfaceAfterResync(
  refreshThreads: () => Promise<void>,
  refreshServerProps: () => void,
): Promise<void> {
  await refreshThreads().catch(() => undefined);
  refreshServerProps();
}

export function documentVersionLabel(document: Document): string | null {
  return displayVersionLabel(document.current_version);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
