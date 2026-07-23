import { describe, expect, it, vi } from 'vitest';
import { pollStep, pollTick } from '@/lib/use-poll-until-settled';

// The shared poll-until-settled skeleton (12A). Its two functional cores are
// exercised directly — no DOM, no timer — so RowPoller, DocumentPoller, and
// SharedDocumentPoller (and, next, the tracked-repo panel #93) can share one
// proven timer/settle/cleanup decision instead of three hand-rolled copies.

describe('pollStep', () => {
  it('settles with the payload when a live read resolves non-null', () => {
    expect(pollStep(false, { id: 7 })).toEqual({ kind: 'settle', payload: { id: 7 } });
  });

  it('keeps polling when a live read resolves null (transient failure or still importing)', () => {
    // `null` is the shared "keep polling" signal each consumer maps its failure to.
    expect(pollStep(false, null)).toEqual({ kind: 'continue' });
  });

  it('aborts once torn down — cancellation wins even over a terminal read', () => {
    // A read that resolves after teardown neither settles nor reschedules: the
    // guard each of the three cleanup functions hand-rolled, made uniform.
    expect(pollStep(true, { id: 7 })).toEqual({ kind: 'abort' });
    expect(pollStep(true, null)).toEqual({ kind: 'abort' });
  });
});

describe('pollTick', () => {
  function harness() {
    const onSettled = vi.fn();
    const reschedule = vi.fn();
    return { onSettled, reschedule };
  }

  it('settles once and does not reschedule on a terminal read', async () => {
    const { onSettled, reschedule } = harness();
    const doc = { id: 7, status: 'ready' };

    await pollTick({
      poll: async () => doc,
      onSettled,
      reschedule,
      isCancelled: () => false,
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(doc);
    expect(reschedule).not.toHaveBeenCalled();
  });

  it('reschedules and does not settle when the read keeps the loop alive (null)', async () => {
    const { onSettled, reschedule } = harness();

    await pollTick({
      poll: async () => null,
      onSettled,
      reschedule,
      isCancelled: () => false,
    });

    expect(reschedule).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('does neither once torn down, even on a terminal read', async () => {
    const { onSettled, reschedule } = harness();

    await pollTick({
      poll: async () => ({ id: 7, status: 'ready' }),
      onSettled,
      reschedule,
      isCancelled: () => true,
    });

    expect(onSettled).not.toHaveBeenCalled();
    expect(reschedule).not.toHaveBeenCalled();
  });

  it('re-reads cancellation AFTER the await, so a teardown during the read still aborts', async () => {
    const { onSettled, reschedule } = harness();
    let cancelled = false;

    await pollTick({
      // The effect tears down while this read is in flight.
      poll: async () => {
        cancelled = true;
        return { id: 7, status: 'ready' };
      },
      onSettled,
      reschedule,
      isCancelled: () => cancelled,
    });

    expect(onSettled).not.toHaveBeenCalled();
    expect(reschedule).not.toHaveBeenCalled();
  });
});
