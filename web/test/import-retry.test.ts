import { describe, expect, it, vi } from 'vitest';
import { importNeedsReconnect, runImportRetry } from '@/lib/import-retry';
import type { ImportOutcome } from '@/lib/documents-client';

// The shared failed-import recovery affordance (SPEC §11 M3.5, decision 7A). Its
// two cores are exercised directly — no DOM — so the documents-list row (#87) can
// consume the same behaviour that the doc page's ImportFailed state does today.

describe('importNeedsReconnect', () => {
  it('branches a dead PAT to the reconnect CTA', () => {
    // The API's token-revoked sync_error carries "reconnect" (SPEC §19).
    expect(
      importNeedsReconnect('GitHub access was revoked. Reconnect the integration in Settings.'),
    ).toBe(true);
    expect(importNeedsReconnect('RECONNECT required')).toBe(true);
  });

  it('leaves a transient or deterministic failure on the retry path', () => {
    expect(importNeedsReconnect('Something went wrong starting the import. Please try again.')).toBe(false);
    expect(importNeedsReconnect('URL not allowed (private address).')).toBe(false);
    expect(importNeedsReconnect(null)).toBe(false);
    expect(importNeedsReconnect('')).toBe(false);
  });
});

describe('runImportRetry', () => {
  function harness() {
    const setPending = vi.fn<(value: boolean) => void>();
    const setError = vi.fn<(message: string | null) => void>();
    const onRetried = vi.fn();
    return { setPending, setError, onRetried };
  }

  it('re-queues the import and refreshes the surface on success', async () => {
    const { setPending, setError, onRetried } = harness();
    const retry = vi.fn(
      async (): Promise<ImportOutcome> => ({ ok: true, document: { id: 7 } as never }),
    );

    await runImportRetry({ id: 7, pending: false, retry, setPending, setError, onRetried });

    expect(retry).toHaveBeenCalledWith(7);
    expect(onRetried).toHaveBeenCalledTimes(1);
    // Error is cleared before the call and never populated on success.
    expect(setError.mock.calls).toEqual([[null]]);
    // Pending is raised for the duration and lowered once, never left stuck on.
    expect(setPending.mock.calls).toEqual([[true], [false]]);
  });

  it('surfaces the failure copy in place and does not refresh', async () => {
    const { setPending, setError, onRetried } = harness();
    const message = 'Something went wrong starting the import. Please try again.';
    const retry = vi.fn(
      async (): Promise<ImportOutcome> => ({ ok: false, kind: 'error', message }),
    );

    await runImportRetry({ id: 7, pending: false, retry, setPending, setError, onRetried });

    expect(retry).toHaveBeenCalledWith(7);
    expect(onRetried).not.toHaveBeenCalled();
    expect(setError.mock.calls).toEqual([[null], [message]]);
    expect(setPending.mock.calls).toEqual([[true], [false]]);
  });

  it('drops a re-entrant click while a retry is already in flight (pending guard)', async () => {
    const { setPending, setError, onRetried } = harness();
    const retry = vi.fn();

    await runImportRetry({ id: 7, pending: true, retry, setPending, setError, onRetried });

    expect(retry).not.toHaveBeenCalled();
    expect(setPending).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
    expect(onRetried).not.toHaveBeenCalled();
  });
});
