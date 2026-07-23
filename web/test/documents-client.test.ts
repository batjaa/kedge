import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDocument, readDocumentPage } from '@/lib/documents-client';

// The BFF read helpers must degrade a fetch REJECTION (a network blip) to null,
// not let it escape (B1): RowPoller relies on null to keep its last state and
// retry next tick, and handleLoadMore relies on it so a rejected page fetch never
// leaks an unhandled rejection. This mirrors DocumentPoller's try/catch semantics.
describe('documents-client transient read failures', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('readDocument resolves to null when the fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')));

    await expect(readDocument(7)).resolves.toBeNull();
  });

  it('readDocumentPage resolves to null when the fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')));

    await expect(readDocumentPage(2)).resolves.toBeNull();
  });

  it('still maps a non-ok response to null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));

    await expect(readDocument(7)).resolves.toBeNull();
    await expect(readDocumentPage(2)).resolves.toBeNull();
  });
});
