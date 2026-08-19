import { describe, expect, it, vi } from 'vitest';
import { AiReplyDraftAction, ReplyDraftConfirm } from '@/components/app/ai-reply-draft';
import { ReplyComposer } from '@/components/app/document-thread-reply-composer';
import { AiCapabilityProvider } from '@/lib/ai-capability';
import { useAiReplyDraft, type UseAiReplyDraftResult } from '@/lib/use-ai-reply-draft';
import type { AiRun, ReplyDraftOutput } from '@/lib/ai-types';
import type { ReviewThread } from '@/lib/thread-types';
import { renderToStaticMarkup } from './render-intl';

/**
 * The reply-draft affordance (M4 #133) and gap G12: a generated draft never
 * replaces the person's own text without an explicit confirmation.
 *
 * The behavioural half runs the real hook through a render harness and asserts
 * the SIDE EFFECT — whether `onInsert` fired — which is observable the moment the
 * call returns, so it needs no DOM and no re-render. The rendering half asserts
 * that the confirmation is what shows up on screen when the hook holds a draft
 * back.
 */
describe('useAiReplyDraft landing (G12)', () => {
  it('inserts directly when the composer is empty', () => {
    const onInsert = vi.fn();
    const draft = renderDraft({ composerBody: '', onInsert });

    const landing = draft.land('Agreed — I will pin the projection version.');

    expect(landing).toEqual({ action: 'insert', body: 'Agreed — I will pin the projection version.' });
    expect(onInsert).toHaveBeenCalledWith('Agreed — I will pin the projection version.');
  });

  it('never touches a composer that already holds typed text', () => {
    const onInsert = vi.fn();
    const draft = renderDraft({ composerBody: 'Half a thought I was still writing', onInsert });

    const landing = draft.land('Agreed — I will pin the projection version.');

    expect(landing.action).toBe('confirm');
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('replaces only once the person explicitly confirms', () => {
    const onInsert = vi.fn();
    const draft = renderDraft({ composerBody: 'Half a thought', onInsert });

    draft.land('Drafted reply.');
    expect(onInsert).not.toHaveBeenCalled();

    draft.confirmReplace();

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith('Drafted reply.');
  });

  it('keeps the typed text when the person declines', () => {
    const onInsert = vi.fn();
    const draft = renderDraft({ composerBody: 'Half a thought', onInsert });

    draft.land('Drafted reply.');
    draft.dismiss();
    draft.confirmReplace();

    expect(onInsert).not.toHaveBeenCalled();
  });

  it('does not wipe the composer with an empty generation', () => {
    const onInsert = vi.fn();
    const draft = renderDraft({ composerBody: 'Half a thought', onInsert });

    expect(draft.land('   ').action).toBe('discard');
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('lands a completed run through the same rule as a direct draft', () => {
    const onInsert = vi.fn();
    const draft = renderDraft({ composerBody: 'Half a thought', onInsert });

    draft.settle(completedRun('Drafted reply.'));

    expect(onInsert).not.toHaveBeenCalled();
  });

  it('lands a completed run straight into an empty composer', () => {
    const onInsert = vi.fn();
    const draft = renderDraft({ composerBody: '', onInsert });

    draft.settle(completedRun('Drafted reply.'));

    expect(onInsert).toHaveBeenCalledWith('Drafted reply.');
  });
});

describe('ReplyDraftConfirm', () => {
  it('shows the draft and offers both choices, defaulting to neither', () => {
    const html = renderToStaticMarkup(
      <ReplyDraftConfirm body="Drafted reply." onReplace={() => {}} onKeep={() => {}} />,
    );

    expect(html).toContain('Replace what you&#x27;ve written?');
    expect(html).toContain('Drafted reply.');
    expect(html).toContain('Use the draft');
    expect(html).toContain('Keep mine');
  });
});

describe('AiReplyDraftAction', () => {
  it('offers the three stances and confirms nothing until a draft arrives', () => {
    const html = renderToStaticMarkup(
      <AiReplyDraftAction threadId={71} composerBody="" disabled={false} onInsert={() => {}} />,
    );

    expect(html).toContain('Draft reply');
    expect(html).toContain('Accept');
    expect(html).toContain('Push back');
    expect(html).toContain('Clarify');
    expect(html).not.toContain('Replace what you&#x27;ve written?');
  });

  it('has no post control of its own — posting stays the human&apos;s submit', () => {
    const html = renderToStaticMarkup(
      <AiReplyDraftAction threadId={71} composerBody="" disabled={false} onInsert={() => {}} />,
    );

    expect(html).not.toContain('Post reply');
  });
});

describe('the composer AI footer', () => {
  it('is absent when the instance has no AI', () => {
    const html = renderToStaticMarkup(
      <ReplyComposer thread={reviewThread()} onReply={async () => null} onMessage={() => {}} />,
    );

    expect(html).not.toContain('Draft reply');
  });

  it('appears when the instance has AI', () => {
    const html = renderToStaticMarkup(
      <AiCapabilityProvider enabled>
        <ReplyComposer thread={reviewThread()} onReply={async () => null} onMessage={() => {}} />
      </AiCapabilityProvider>,
    );

    expect(html).toContain('Draft reply');
  });
});

function completedRun(body: string): AiRun<ReplyDraftOutput> {
  return {
    id: 12,
    document_id: 67,
    type: 'reply_draft',
    variant: 'accept',
    status: 'completed',
    model: 'claude-sonnet-5',
    tokens: 400,
    cost: 0.002,
    output: {
      stance: 'accept',
      body,
      coverage: { covered: 3, total: 3, chunked: false, statement: 'Covers all 3 comments.' },
    },
    error: null,
    created_at: '2026-08-18T10:00:00Z',
    updated_at: '2026-08-18T10:00:05Z',
  };
}

/**
 * Render the real hook and hand back its API. Its landing calls read the
 * composer body and the insert callback from refs, so calling them here exercises
 * exactly what a click would.
 */
function renderDraft({ composerBody, onInsert }: {
  composerBody: string;
  onInsert: (body: string) => void;
}): UseAiReplyDraftResult {
  let api: UseAiReplyDraftResult | null = null;

  function Harness() {
    api = useAiReplyDraft({ threadId: 71, composerBody, onInsert });

    return <span>{api.stance ?? 'none'}</span>;
  }

  renderToStaticMarkup(<Harness />);
  if (!api) throw new Error('Hook did not render');

  return api;
}

function reviewThread(): ReviewThread {
  return {
    id: 71,
    document_id: 67,
    type: 'inline',
    status: 'open',
    forked_from_comment_id: null,
    forked_into_count: 0,
    forked_into: [],
    created_by: 1,
    comment_count: 1,
    latest_activity_at: null,
    anchor: null,
    first_comment: null,
    comments: [],
    can_resolve: true,
    can_reopen: false,
    can_reanchor: false,
    created_at: null,
    updated_at: null,
  };
}
