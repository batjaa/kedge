'use client';

import { MessageCircleQuestion } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AI_BUTTON_CLASS } from './ai-artifact-dialog';

/**
 * The header's way into the ask conversation (SPEC §14, user story 23 — M4
 * #139, right-rail chat since #151).
 *
 * A button, and nothing else. Until #151 this component also OWNED the ask —
 * the dialog, the question, the run, the answer — which is precisely what made
 * the feature single-turn: closing the dialog unmounted the state, so there was
 * no conversation for a follow-up to continue. The conversation now lives in the
 * review surface (`useAskConversation`) and renders in the rail
 * (`AiAskChatPanel`), so both entry points — this button and the selection
 * popover's Ask pill — open one panel holding one conversation.
 *
 * Still no write path (hard rule 5): this opens a place to read, and the api has
 * no endpoint that could turn an answer into review data.
 */
export function AiAskAction({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('ai-ask');

  return (
    <button type="button" onClick={onOpen} className={AI_BUTTON_CLASS}>
      <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
      {t('trigger')}
    </button>
  );
}
