import { describe, expect, it } from 'vitest';
import { AI_BUTTON_CLASS, AI_NEUTRAL_BUTTON_CLASS } from '@/components/app/ai-artifact-dialog';
import { ReplyDraftConfirm } from '@/components/app/ai-reply-draft';
import { AiSplitProposals } from '@/components/app/ai-split-proposals';
import { AI_ICON_TONE_CLASS, AI_TONE_CLASS, AI_TONE_QUIET_CLASS } from '@/components/app/ai-tone';
import { DocumentCommentComposer, type ComposerState } from '@/components/app/document-comment-composer';
import { IconButton } from '@/components/app/document-thread-ui';
import { initialSplitApprovals } from '@/lib/ai-split';
import type { SplitOutput } from '@/lib/ai-types';
import { renderToStaticMarkup } from './render-intl';

// The colour contract of the agent register (#143).
//
// This ticket was colour only, which is exactly the kind of change that rots
// silently: nothing throws when an AI CTA drifts back onto the human primary,
// and no journey fails. So the contract is asserted directly — an AI CTA is
// violet in BOTH themes and never zinc-900; a human write is zinc-900/emerald
// and never violet.
//
// Assertions are on the CLASS STRINGS rather than on rendered pixels, because
// the thing being protected is the token choice. The tests below cover both
// halves of the line: the tone fragments every AI CTA is built from, and the
// three controls where an AI button and a human button sit side by side.

/** Every `<button>` in a markup string, one entry per element. */
function buttons(html: string): string[] {
  return html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

/** The one button whose rendered text contains `label`. */
function buttonWith(html: string, label: string): string {
  const found = buttons(html).filter((button) => button.includes(label));
  expect(found, `expected exactly one button containing "${label}"`).toHaveLength(1);

  return found[0] as string;
}

const SELECTION: ComposerState = {
  open: true,
  stage: 'affordance',
  mode: 'inline',
  anchor: {
    exact: 'Re-anchoring keeps a comment attached across versions.',
    prefix: '',
    suffix: '',
    start: 40,
    end: 94,
    heading_path: ['Anchoring RFC'],
    projection_version: 2,
  },
  failure: null,
  x: 200,
  y: 120,
};

function selectionPopover(): string {
  return renderToStaticMarkup(
    <DocumentCommentComposer
      documentId={7}
      composer={SELECTION}
      commentType="comment"
      body=""
      proposedText=""
      message={null}
      submitting={false}
      onBodyChange={() => {}}
      onProposedTextChange={() => {}}
      onCommentTypeChange={() => {}}
      onClose={() => {}}
      onOpenPanel={() => {}}
      onAsk={() => {}}
      onSubmit={() => {}}
    />,
  );
}

const SPLIT_OUTPUT: SplitOutput = {
  proposals: [
    { title: 'Budget number', fragment: 'The budget needs a real number.', anchor: null },
  ],
  coverage: { covered: 1, total: 1, chunked: false, statement: 'Covers all 1 comment.' },
};

function splitProposals(): string {
  return renderToStaticMarkup(
    <AiSplitProposals
      output={SPLIT_OUTPUT}
      approvals={initialSplitApprovals(SPLIT_OUTPUT.proposals.length)}
      model="claude-sonnet-5"
      busy={false}
      onApprove={() => {}}
      onApproveAll={() => {}}
    />,
  );
}

describe('the agent register', () => {
  it.each([
    ['filled', AI_TONE_CLASS],
    ['quiet', AI_TONE_QUIET_CLASS],
    ['icon', AI_ICON_TONE_CLASS],
  ])('names violet in both themes for the %s tone', (_name, tone) => {
    expect(tone).toMatch(/(?<!dark:)text-violet-\d00/);
    expect(tone).toMatch(/dark:text-violet-\d00/);
    expect(tone).toMatch(/(?<!dark:)ring-violet-\d00/);
    expect(tone).toMatch(/dark:ring-violet-\d00/);
  });

  it.each([
    ['filled', AI_TONE_CLASS],
    ['quiet', AI_TONE_QUIET_CLASS],
    ['icon', AI_ICON_TONE_CLASS],
  ])('never falls back to the human primary for the %s tone', (_name, tone) => {
    expect(tone).not.toContain('bg-zinc-900');
    expect(tone).not.toContain('text-white');
    expect(tone).not.toContain('emerald');
  });

  it.each([
    ['filled', AI_TONE_CLASS],
    ['quiet', AI_TONE_QUIET_CLASS],
    ['icon', AI_ICON_TONE_CLASS],
  ])('defines a hover in both themes for the %s tone', (_name, tone) => {
    expect(tone).toMatch(/(?<!dark:)hover:bg-/);
    expect(tone).toMatch(/dark:hover:bg-/);
  });

  it('builds the shared AI button on the filled tone, and leaves Copy neutral', () => {
    // The header trio and every dialog action read from these two constants, so
    // this is the whole artifact surface in one assertion.
    expect(AI_BUTTON_CLASS).toContain(AI_TONE_CLASS);
    expect(AI_NEUTRAL_BUTTON_CLASS).not.toContain('violet');
  });

  it('tints the agent icon square and leaves the neutral one alone', () => {
    const agent = renderToStaticMarkup(
      <IconButton tone="agent" title="Propose a split" onClick={() => {}}>
        <span />
      </IconButton>,
    );
    const neutral = renderToStaticMarkup(
      <IconButton title="Fork into new thread" onClick={() => {}}>
        <span />
      </IconButton>,
    );

    expect(agent).toContain('text-violet-600');
    expect(neutral).not.toContain('violet');
    expect(neutral).toContain('text-zinc-500');
  });
});

describe('AI and human controls that sit side by side', () => {
  it('separates the selection popover: Ask is violet, Comment is not', () => {
    const html = selectionPopover();

    expect(buttonWith(html, 'Ask AI')).toContain('text-violet-700');
    const comment = buttonWith(html, 'Comment');
    expect(comment).not.toContain('violet');
    expect(comment).toContain('bg-zinc-900');
  });

  it('separates the draft confirm: the draft is violet, keeping yours is not', () => {
    const html = renderToStaticMarkup(
      <ReplyDraftConfirm body="A drafted reply." onKeep={() => {}} onReplace={() => {}} />,
    );

    expect(buttonWith(html, 'Use the draft')).toContain('text-violet-700');
    expect(buttonWith(html, 'Keep mine')).not.toContain('violet');
  });

  it('keeps split approval human: it posts a forked thread under your name', () => {
    const html = splitProposals();
    const approve = buttonWith(html, 'Approve<');

    expect(approve).not.toContain('violet');
    expect(approve).toContain('bg-zinc-900');
    expect(approve).toContain('dark:bg-emerald-400/10');
  });
});
