'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Whether this instance has AI at all, made available to the thread panel (M4).
 *
 * The capability is read once on the server (`getCapabilities().ai`, itself
 * fail-closed) and handed to the review surface. From there the AI affordances
 * live several components deep — inside a thread card, inside its composer — and
 * threading a boolean through the rail, the mobile sheet, and every card in
 * between would put the same prop on five signatures that have nothing to do with
 * AI, and put it there again for every future AI affordance.
 *
 * Default FALSE, deliberately: a component rendered outside the provider (a test,
 * a surface that never received the capability) shows no AI at all. That matches
 * the BYO-key rule everywhere else in the stack — absent, never broken (SPEC §14).
 */
const AiCapabilityContext = createContext(false);

export function AiCapabilityProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <AiCapabilityContext value={enabled}>{children}</AiCapabilityContext>;
}

export function useAiEnabled(): boolean {
  return useContext(AiCapabilityContext);
}
