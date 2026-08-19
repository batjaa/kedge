'use client';

import { readAiRun } from '@/lib/ai-client';
import { aiRunSettled } from '@/lib/ai-run';
import type { AiRun } from '@/lib/ai-types';
import { usePollUntilSettled } from '@/lib/use-poll-until-settled';

/**
 * One in-flight AI run's poll loop — the shared hook's AI consumer. Polls the
 * run until it reaches a terminal status, then hands it up. Renders nothing.
 *
 * Mounted only while a run is actually in flight, so an idle panel keeps no
 * timer alive; every artifact panel (digest, improve-prompt) uses this same one.
 */
export function AiRunPoller({
  runId,
  onSettled,
}: {
  runId: number;
  onSettled: (run: AiRun) => void;
}) {
  usePollUntilSettled<AiRun>({
    poll: async () => aiRunSettled(await readAiRun(runId)),
    onSettled,
    key: runId,
  });

  return null;
}
