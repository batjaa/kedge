'use client';

import { useEffect, useRef, useState } from 'react';
import { aiArtifactPhase, isAiRunInFlight, type AiArtifactPhase } from './ai-run';
import type { StartDigestOutcome } from './ai-client';
import type { AiRun } from './ai-types';

/**
 * One AI artifact's run lifecycle on the document header (SPEC §14, M4): the
 * re-attach on mount, the request with its double-click guard, the phase the
 * panel renders, and the client-side taking-too-long ceiling.
 *
 * Every artifact off the `ai_runs` ledger runs this identical machine — only the
 * two endpoints differ — so the digest (#130) and the improve-the-doc prompt
 * (#132) share it rather than each keeping a copy that could drift on the parts
 * that cost money (the dedupe re-attach, the request guard).
 *
 * Polling is deliberately NOT started here: the poll loop belongs to
 * {@link AiRunPoller}, mounted only while a run is in flight, so an idle panel
 * keeps no timer alive.
 */

export type AiArtifactFailure = Extract<StartDigestOutcome, { ok: false }>;

export function useAiArtifactRun({
  documentId,
  start,
  readLatest,
}: {
  documentId: number;
  start: (documentId: number) => Promise<StartDigestOutcome>;
  readLatest: (documentId: number) => Promise<AiRun | null>;
}): {
  run: AiRun | null;
  phase: AiArtifactPhase;
  inFlight: boolean;
  pending: boolean;
  failure: AiArtifactFailure | null;
  request: () => Promise<void>;
  settle: (run: AiRun) => void;
  fail: (failure: AiArtifactFailure | null) => void;
} {
  const [run, setRun] = useState<AiRun | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<AiArtifactFailure | null>(null);
  const requestingRef = useRef(false);

  // Re-attach on mount (eng review §8): a run started before a reload, or
  // finished while the tab was closed, is picked back up rather than forgotten
  // and re-billed.
  useEffect(() => {
    let cancelled = false;

    readLatest(documentId).then((latest) => {
      if (cancelled || latest === null) return;

      // Monotonic: a slow hydration must never displace a run the user started
      // while it was in flight — that would strand the new run's poller.
      setRun((current) => (current === null || current.id < latest.id ? latest : current));
    });

    return () => {
      cancelled = true;
    };
    // `readLatest` is a module-level function per artifact; the document is the
    // only thing that can change under this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const inFlight = run !== null && isAiRunInFlight(run.status);

  // Drives the client-side taking-too-long ceiling while a run is in flight.
  useEffect(() => {
    if (!inFlight) return;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [inFlight, run?.id]);

  async function request() {
    if (requestingRef.current) return;
    requestingRef.current = true;
    setPending(true);
    setFailure(null);

    const outcome = await start(documentId);

    requestingRef.current = false;
    setPending(false);

    if (outcome.ok) {
      setRun(outcome.run);
      return;
    }

    setFailure(outcome);
  }

  return {
    run,
    phase: aiArtifactPhase(run, now),
    inFlight,
    pending,
    failure,
    request,
    settle: setRun,
    fail: setFailure,
  };
}
