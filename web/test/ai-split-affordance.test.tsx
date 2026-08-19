import { describe, expect, it } from 'vitest';
import { CommentRow } from '@/components/app/document-thread-comment-row';
import type { ThreadComment } from '@/lib/thread-types';
import { renderToStaticMarkup } from './render-intl';

// The BYO-key gate at the component seam (#134, AC "affordance absent when AI is
// disabled"). `onApproveSplit` is the capability: the review surface passes it
// only when the api reported a configured Anthropic key AND the reader is on the
// current version, and the share surface never passes it at all. Without it the
// split button must not exist — not disabled, absent.

function fixtureComment(overrides: Partial<ThreadComment> = {}): ThreadComment {
  return {
    id: 41,
    thread_id: 7,
    type: 'comment',
    body_md: 'This comment raises two separate issues at once.',
    mentions: [],
    proposed_text: null,
    suggestion_status: null,
    client: 'web',
    edited_at: null,
    is_deleted: false,
    deleted_at: null,
    can_edit: true,
    can_delete: true,
    can_fork: true,
    can_resolve_suggestion: false,
    can_react: false,
    reaction_count: 0,
    viewer_has_reacted: false,
    created_at: null,
    ...overrides,
  };
}

function render(options: {
  comment?: Partial<ThreadComment>;
  isReply?: boolean;
  withSplit?: boolean;
} = {}): string {
  return renderToStaticMarkup(
    <CommentRow
      comment={fixtureComment(options.comment)}
      isReply={options.isReply ?? true}
      editing={false}
      editBody=""
      forking={false}
      deleting={false}
      anchorExact={null}
      suggestionBusy={false}
      reactionBusy={false}
      onStartEdit={() => {}}
      onCancelEdit={() => {}}
      onEditBodyChange={() => {}}
      onSaveEdit={() => {}}
      onFork={() => {}}
      onDelete={() => {}}
      onSetSuggestionStatus={() => {}}
      onToggleReaction={() => {}}
      onApproveSplit={options.withSplit === false ? undefined : async () => null}
    />,
  );
}

describe('the split affordance', () => {
  it('appears beside fork on a forkable reply when AI is enabled', () => {
    expect(render()).toContain('Propose a split');
  });

  it('is absent when AI is disabled — no capability, no button', () => {
    expect(render({ withSplit: false })).not.toContain('Propose a split');
  });

  it('is absent wherever a fork could not land anyway', () => {
    // A thread's opening comment cannot be forked, so it cannot be split: the
    // server refuses both, and offering the button would be a dead end.
    expect(render({ isReply: false })).not.toContain('Propose a split');

    expect(render({ comment: { can_fork: false } })).not.toContain('Propose a split');
    expect(render({ comment: { is_deleted: true } })).not.toContain('Propose a split');
  });
});
