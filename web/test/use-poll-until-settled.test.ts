import { describe, expect, it, vi } from 'vitest';
import { pollStep, pollTick, startPollLoop } from '@/lib/use-poll-until-settled';

// The shared poll-until-settled skeleton (12A). Its functional cores are
// exercised directly — no DOM, no timer — so RowPoller, DocumentPoller,
// SharedDocumentPoller, and the tracked-repo panel share one proven
// timer/settle/cleanup decision instead of four hand-rolled copies. `startPollLoop`
// is the stateful core the hook wraps with refs + a `key` dependency, so its
// no-stale-closure and restart-on-key-change guarantees are provable here too.

// Drain the microtask chain pollTick walks (await poll(), then settle/reschedule)
// with a single real macrotask — no fake timers.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// A hand-cranked stand-in for setTimeout: the loop hands us the next tick via
// `schedule`; the test fires it with `take()` so the loop advances deterministically
// with neither a timer nor a DOM.
function fakeScheduler() {
  let queued: (() => void) | null = null;
  return {
    schedule: (run: () => void) => {
      queued = run;
    },
    cancel: () => {
      queued = null;
    },
    pending: () => queued !== null,
    take: () => {
      const run = queued;
      queued = null;
      return run;
    },
  };
}

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

describe('startPollLoop', () => {
  type Doc = { id: number };

  async function runTick(run: (() => void) | null) {
    run?.();
    await flush();
  }

  it('schedules the first tick, then reschedules while reads keep the loop alive', async () => {
    const scheduler = fakeScheduler();
    const onSettled = vi.fn();

    startPollLoop<Doc>({
      getPoll: () => async () => null,
      getOnSettled: () => onSettled,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });

    // The loop scheduled its first tick without polling immediately.
    expect(scheduler.pending()).toBe(true);

    await runTick(scheduler.take());
    // A null read keeps polling: nothing settled, the next tick is queued.
    expect(onSettled).not.toHaveBeenCalled();
    expect(scheduler.pending()).toBe(true);
  });

  it('reads the latest poll and onSettled on every tick — a re-render is never stale', async () => {
    const scheduler = fakeScheduler();

    // The first render's closures: the read keeps the loop alive, and this
    // onSettled must NEVER fire once the callbacks are swapped underneath it.
    let poll = async (): Promise<Doc | null> => null;
    const staleOnSettled = vi.fn();
    let onSettled = staleOnSettled;

    startPollLoop<Doc>({
      getPoll: () => poll,
      getOnSettled: () => onSettled,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });

    // First tick: still importing → keep polling on the original closures.
    await runTick(scheduler.take());
    expect(staleOnSettled).not.toHaveBeenCalled();

    // The consumer re-renders with fresh closures — exactly what the hook's refs
    // now point at. The loop was NOT restarted (same key), yet the next tick must
    // pick these up, not the ones captured when the loop started.
    const doc: Doc = { id: 42 };
    const freshOnSettled = vi.fn();
    poll = async () => doc;
    onSettled = freshOnSettled;

    await runTick(scheduler.take());
    expect(freshOnSettled).toHaveBeenCalledTimes(1);
    expect(freshOnSettled).toHaveBeenCalledWith(doc);
    expect(staleOnSettled).not.toHaveBeenCalled();
    // Settled: the loop stops rescheduling.
    expect(scheduler.pending()).toBe(false);
  });

  it('teardown cancels the loop — a read in flight when the key changes can never settle', async () => {
    const scheduler = fakeScheduler();
    const onSettled = vi.fn();

    // A read still in flight when the key changes: released only after teardown.
    let release: (value: Doc) => void = () => {};
    const inFlight = new Promise<Doc>((resolve) => {
      release = resolve;
    });

    const teardown = startPollLoop<Doc>({
      getPoll: () => () => inFlight,
      getOnSettled: () => onSettled,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });

    // Fire the tick so the read starts, but leave it suspended on the await.
    scheduler.take()?.();

    // The key changes: React runs the effect cleanup (teardown) before the new
    // loop starts. Cleanup latches cancelled and cancels any queued tick.
    teardown();
    expect(scheduler.pending()).toBe(false);

    // Only now does the old key's read resolve — it must be dropped, not settled.
    release({ id: 1 });
    await flush();

    expect(onSettled).not.toHaveBeenCalled();
  });

  it('a fresh loop after teardown settles on its own key, independent of the torn-down one', async () => {
    const scheduler = fakeScheduler();

    // The old key's loop: torn down before it can settle (its tick discarded).
    const first = vi.fn();
    const teardownOld = startPollLoop<Doc>({
      getPoll: () => async () => ({ id: 1 }),
      getOnSettled: () => first,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });
    teardownOld();
    scheduler.take();

    // The new key's loop runs on its own and settles through its own callback.
    const doc: Doc = { id: 7 };
    const second = vi.fn();
    startPollLoop<Doc>({
      getPoll: () => async () => doc,
      getOnSettled: () => second,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });

    await runTick(scheduler.take());
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(doc);
    expect(first).not.toHaveBeenCalled();
  });
});
