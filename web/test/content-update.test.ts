import { describe, expect, it, vi } from 'vitest';
import { runContentUpdate } from '@/lib/content-update';
import type { ImportOutcome } from '@/lib/documents-client';
import type { ResyncPollResult } from '@/lib/resync-polling';

// The pasted-content update surface's behaviour (#113), exercised without a DOM —
// the same seam discipline as import-retry.test.ts. runContentUpdate POSTs the
// new body, then maps the shared version-settle poll to one exhaustive set of
// outcomes; every branch is asserted here, including that a size-cap 422 never
// reaches the poll and that a deduped no-op is reported honestly (never a phantom
// success).

function harness(
  overrides: {
    update?: (id: number, content: string, title?: string) => Promise<ImportOutcome>;
    waitForCompletion?: (id: number, label: string | null | undefined) => Promise<ResyncPollResult>;
  } = {},
) {
  const onAdvanced = vi.fn(async () => undefined);
  const onServerRefresh = vi.fn();
  const update =
    overrides.update ??
    vi.fn(async (): Promise<ImportOutcome> => ({ ok: true, document: { id: 7 } as never }));
  const waitForCompletion =
    overrides.waitForCompletion ??
    vi.fn(async (): Promise<ResyncPollResult> => ({ status: 'advanced' }));

  return { onAdvanced, onServerRefresh, update, waitForCompletion };
}

function run(deps: ReturnType<typeof harness>) {
  return runContentUpdate({
    documentId: 7,
    content: '# New body',
    title: 'A title',
    startingVersionLabel: 'v1',
    update: deps.update,
    waitForCompletion: deps.waitForCompletion,
    onAdvanced: deps.onAdvanced,
    onServerRefresh: deps.onServerRefresh,
  });
}

describe('runContentUpdate', () => {
  it('refreshes the surface and reports advanced when a new version lands', async () => {
    const deps = harness();

    const result = await run(deps);

    expect(deps.update).toHaveBeenCalledWith(7, '# New body', 'A title');
    expect(deps.waitForCompletion).toHaveBeenCalledWith(7, 'v1');
    expect(deps.onAdvanced).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'advanced' });
  });

  it('reports an identical body as unchanged, never a phantom success', async () => {
    // A deduped update never advances the version label → the poll times out.
    const deps = harness({
      waitForCompletion: vi.fn(async (): Promise<ResyncPollResult> => ({ status: 'timeout' })),
    });

    const result = await run(deps);

    expect(result.status).toBe('unchanged');
    expect(result).toMatchObject({ message: expect.stringMatching(/identical/i) });
    // The flip never happened, so threads are not reloaded — only server props.
    expect(deps.onAdvanced).not.toHaveBeenCalled();
    expect(deps.onServerRefresh).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed sync with the server copy and refreshes server props', async () => {
    const deps = harness({
      waitForCompletion: vi.fn(
        async (): Promise<ResyncPollResult> => ({
          status: 'failed',
          message: 'Sync failed — showing last good version. Try again.',
        }),
      ),
    });

    const result = await run(deps);

    expect(result).toEqual({
      status: 'failed',
      message: 'Sync failed — showing last good version. Try again.',
    });
    expect(deps.onAdvanced).not.toHaveBeenCalled();
    expect(deps.onServerRefresh).toHaveBeenCalledTimes(1);
  });

  it('returns the size-cap validation message in place without polling', async () => {
    const waitForCompletion = vi.fn(async (): Promise<ResyncPollResult> => ({ status: 'advanced' }));
    const deps = harness({
      update: vi.fn(
        async (): Promise<ImportOutcome> => ({
          ok: false,
          kind: 'validation',
          message: 'The given data was invalid.',
          errors: { content: ['The pasted content may not be larger than 2 MB.'] },
        }),
      ),
      waitForCompletion,
    });

    const result = await run(deps);

    expect(result).toEqual({
      status: 'validation',
      message: 'The pasted content may not be larger than 2 MB.',
    });
    // A rejected request must never reach the poll or any refresh.
    expect(waitForCompletion).not.toHaveBeenCalled();
    expect(deps.onAdvanced).not.toHaveBeenCalled();
    expect(deps.onServerRefresh).not.toHaveBeenCalled();
  });

  it('maps a transport failure to an error result', async () => {
    const deps = harness({
      update: vi.fn(
        async (): Promise<ImportOutcome> => ({
          ok: false,
          kind: 'error',
          message: 'Something went wrong updating the content. Please try again.',
        }),
      ),
    });

    const result = await run(deps);

    expect(result).toEqual({
      status: 'error',
      message: 'Something went wrong updating the content. Please try again.',
    });
    expect(deps.onAdvanced).not.toHaveBeenCalled();
  });
});
