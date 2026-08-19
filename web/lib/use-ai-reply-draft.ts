'use client';

import { useCallback, useRef, useState } from 'react';
import { startReplyDraft } from './ai-client';
import { replyDraftLanding, type ReplyDraftLanding } from './ai-triage';
import type { AiRun, ReplyDraftOutput, ReplyStance } from './ai-types';

/**
 * The reply-draft interaction, lifted out of the component (M4 #133).
 *
 * The whole reason this is a hook and not inline state is the landing rule: what
 * happens when a generated draft arrives at a composer that already holds typed
 * text. That decision protects a person's own words, so it is reachable from a
 * test without a browser — {@link land} and {@link confirmReplace} read their
 * inputs from refs, which means their effects are observable the moment they are
 * called, with no re-render required.
 *
 * Nothing here posts. `onInsert` writes into the composer; the review write stays
 * the person's normal submit (hard rule 5).
 */
export interface UseAiReplyDraftResult {
  /** The run being polled, or null before anything was asked for. */
  run: AiRun<ReplyDraftOutput> | null;
  /** The stance most recently requested — what the UI is waiting on. */
  stance: ReplyStance | null;
  /** True between the POST leaving and the run coming back. */
  requesting: boolean;
  /**
   * A generated draft held back because the composer was not empty. It is shown
   * for review and replaces nothing until {@link confirmReplace} (G12).
   */
  pendingReplace: string | null;
  error: string | null;
  request: (stance: ReplyStance) => Promise<void>;
  /** Feed a settled run back in — the poller's terminal handoff. */
  settle: (run: AiRun<ReplyDraftOutput>) => void;
  /** Apply generated text to the composer under the landing rule. */
  land: (generated: string) => ReplyDraftLanding;
  confirmReplace: () => void;
  dismiss: () => void;
}

export function useAiReplyDraft({ threadId, composerBody, onInsert }: {
  threadId: number;
  composerBody: string;
  onInsert: (body: string) => void;
}): UseAiReplyDraftResult {
  const [run, setRun] = useState<AiRun<ReplyDraftOutput> | null>(null);
  const [stance, setStance] = useState<ReplyStance | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [pendingReplace, setPendingReplaceState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestingRef = useRef(false);
  const pendingRef = useRef<string | null>(null);
  // Read at landing time, never captured: the person may have kept typing while
  // the model was working, and it is the text in front of them right now that
  // must not be thrown away.
  const composerBodyRef = useRef(composerBody);
  const onInsertRef = useRef(onInsert);

  composerBodyRef.current = composerBody;
  onInsertRef.current = onInsert;

  const setPendingReplace = useCallback((body: string | null) => {
    pendingRef.current = body;
    setPendingReplaceState(body);
  }, []);

  const land = useCallback((generated: string): ReplyDraftLanding => {
    const landing = replyDraftLanding({ composerBody: composerBodyRef.current, generated });

    if (landing.action === 'insert') {
      setPendingReplace(null);
      onInsertRef.current(landing.body);

      return landing;
    }

    // 'confirm' parks the draft; 'discard' means there was nothing worth
    // inserting. Neither one touches the composer — which is the point.
    setPendingReplace(landing.action === 'confirm' ? landing.body : null);

    return landing;
  }, [setPendingReplace]);

  const settle = useCallback((settled: AiRun<ReplyDraftOutput>) => {
    setRun(settled);

    if (settled.status === 'completed' && settled.output) {
      land(settled.output.body);
    }
  }, [land]);

  const request = useCallback(async (next: ReplyStance) => {
    if (requestingRef.current) return;

    requestingRef.current = true;
    setRequesting(true);
    setError(null);
    setStance(next);
    // A fresh request supersedes a draft still awaiting a decision: leaving the
    // old one on screen would make "Replace my text" ambiguous about which draft
    // it means.
    setPendingReplace(null);
    setRun(null);

    const outcome = await startReplyDraft(threadId, next);

    requestingRef.current = false;
    setRequesting(false);

    if (outcome.ok) {
      setRun(outcome.run as AiRun<ReplyDraftOutput>);

      return;
    }

    setError(outcome.message);
  }, [setPendingReplace, threadId]);

  const confirmReplace = useCallback(() => {
    const body = pendingRef.current;

    if (body === null) return;

    setPendingReplace(null);
    onInsertRef.current(body);
  }, [setPendingReplace]);

  const dismiss = useCallback(() => {
    setPendingReplace(null);
    setError(null);
  }, [setPendingReplace]);

  return { run, stance, requesting, pendingReplace, error, request, settle, land, confirmReplace, dismiss };
}
