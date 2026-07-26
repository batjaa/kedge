import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from './render-intl';
import { CommentRow } from '@/components/app/document-thread-comment-row';
import { StatusBadge, SuggestionStatusBadge } from '@/components/app/document-thread-badges';
import { DocumentShares } from '@/components/app/document-shares';
import type { ThreadComment } from '@/lib/thread-types';

// The #126 unit seam: review-surface components read the threads/shares
// catalogs on the ACTIVE locale, while user-authored comment text is rendered
// verbatim — never translated (SPEC m3.9 hard rule). The journey
// (e2e/i18n-review.spec.ts) proves this end to end; this pins it at the
// component level so a regression fails in vitest, not only in Playwright.

const COMMENT_BODY = 'The prose of this comment stays exactly as authored.';

function fixtureComment(overrides: Partial<ThreadComment> = {}): ThreadComment {
  return {
    id: 41,
    thread_id: 7,
    type: 'comment',
    body_md: COMMENT_BODY,
    mentions: [],
    proposed_text: null,
    suggestion_status: null,
    client: 'web',
    edited_at: '2026-07-20T18:00:00Z',
    is_deleted: false,
    deleted_at: null,
    can_edit: true,
    can_delete: true,
    can_fork: false,
    can_resolve_suggestion: false,
    can_react: false,
    reaction_count: 0,
    viewer_has_reacted: false,
    created_at: null,
    ...overrides,
  };
}

function renderCommentRow(locale?: Parameters<typeof renderToStaticMarkup>[1]): string {
  return renderToStaticMarkup(
    <CommentRow
      comment={fixtureComment()}
      isReply={false}
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
    />,
    locale,
  );
}

describe('review-surface chrome localizes; comment bodies never do (#126)', () => {
  it('renders German comment-row chrome around the verbatim body', () => {
    const html = renderCommentRow('de-DE');

    // Chrome from the de-DE threads catalog…
    expect(html).toContain('Prüfer'); // author fallback
    expect(html).toContain('bearbeitet'); // edited marker
    expect(html).toContain('Kommentar bearbeiten'); // edit action title
    expect(html).toContain('Kommentar löschen'); // delete action title
    expect(html).not.toContain('Edit comment');
    expect(html).not.toContain('Delete comment');

    // …around the user's text, byte-identical.
    expect(html).toContain(COMMENT_BODY);
  });

  it('renders the en-US chrome byte-identical to the pre-catalog literals', () => {
    const html = renderCommentRow();

    expect(html).toContain('Reviewer');
    expect(html).toContain('edited');
    expect(html).toContain('Edit comment');
    expect(html).toContain(COMMENT_BODY);
  });

  it('status badges read the threads catalog on the active locale', () => {
    const open = renderToStaticMarkup(
      <StatusBadge status="open" suggestion={false} agent={false} />,
      'mn-MN',
    );
    expect(open).toContain('нээлттэй');

    const pending = renderToStaticMarkup(<SuggestionStatusBadge status="pending" />, 'de-DE');
    expect(pending).toContain('ausstehend');
  });

  it('share-link management renders from the shares catalog', () => {
    // Static markup never runs effects, so the section stays in its loading
    // state — heading and loading copy are both catalog strings.
    const html = renderToStaticMarkup(<DocumentShares documentId={1} />, 'es-US');

    expect(html).toContain('Enlaces para compartir');
    expect(html).toContain('Cargando enlaces…');
    expect(html).not.toContain('Share links');
  });
});
