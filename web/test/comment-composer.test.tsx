import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentCommentComposer, type ComposerState } from '@/components/app/document-comment-composer';
import { MentionTextarea } from '@/components/app/mention-textarea';
import { postDocumentComposerDraft, postReplyComposerDraft } from '@/lib/comment-composer-actions';
import { createCommentForkGuard } from '@/lib/comment-fork-guard';
import {
  commentDraftContextKey,
  commentDraftStorageKey,
  resetCommentDraftMemoryForTests,
  useCommentDraft,
  type UseCommentDraftOptions,
  type UseCommentDraftResult,
} from '@/lib/comment-draft';
import type { CreateThreadInput, CreateThreadOutcome, ReplyToThreadInput } from '@/lib/comments-client';
import type { ReviewThread } from '@/lib/thread-types';

class TestStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

afterEach(() => {
  resetCommentDraftMemoryForTests();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
});

describe('document comment composer regressions', () => {
  it('disables the whole suggestion composer while submitting', () => {
    const html = renderToStaticMarkup(
      <DocumentCommentComposer
        documentId={67}
        composer={inlineComposer()}
        commentType="suggestion"
        body="Keep this note"
        proposedText="Replacement text"
        message={null}
        submitting
        onBodyChange={() => {}}
        onProposedTextChange={() => {}}
        onCommentTypeChange={() => {}}
        onClose={() => {}}
        onOpenPanel={() => {}}
        onSubmit={() => {}}
      />,
    );

    expect(countDisabledAttributes(html)).toBe(6);
    expect(html).toContain('placeholder="Replacement text"');
    expect(html).toContain('placeholder="Add a note"');
  });

  it('treats mode and textarea changes as no-ops while submitting', () => {
    const onMode = vi.fn();
    const onBody = vi.fn();
    const onProposedText = vi.fn();
    const element = renderedComposer({
      composer: inlineComposer(),
      commentType: 'suggestion',
      body: 'Stable body',
      proposedText: 'Stable replacement',
      submitting: true,
      onBodyChange: onBody,
      onProposedTextChange: onProposedText,
      onCommentTypeChange: onMode,
    });

    buttonByText(element, 'Comment').props.onClick();
    mentionTextareaByPlaceholder(element, 'Add a note').props.onChange('late body');
    textareaByPlaceholder(element, 'Replacement text').props.onChange({ target: { value: 'late replacement' } });

    expect(onMode).not.toHaveBeenCalled();
    expect(onBody).not.toHaveBeenCalled();
    expect(onProposedText).not.toHaveBeenCalled();
  });

  it('preserves the body and storage key when toggling from comment to suggestion', () => {
    const storage = installStorage(new TestStorage());
    const contextKey = commentDraftContextKey({
      documentId: 67,
      target: {
        type: 'anchor',
        anchor: { exact: 'Original text', start: 10, end: 23, projection_version: 1 },
      },
    });
    const storageKey = commentDraftStorageKey(contextKey);
    let draft: UseCommentDraftResult | null = null;

    function Harness() {
      draft = useCommentDraft(contextKey, {
        initialProposedText: 'Original text',
        generateIdempotencyKey: () => 'mode-toggle-key',
      });

      return (
        <DocumentCommentComposer
          documentId={67}
          composer={inlineComposer()}
          commentType={draft.mode}
          body={draft.body}
          proposedText={draft.proposedText}
          message={null}
          submitting={false}
          onBodyChange={draft.setBody}
          onProposedTextChange={draft.setProposedText}
          onCommentTypeChange={draft.setMode}
          onClose={draft.clear}
          onOpenPanel={() => {}}
          onSubmit={() => {}}
        />
      );
    }

    renderToStaticMarkup(<Harness />);
    const mountedDraft = requireDraft(draft);
    mountedDraft.setBody('Body written before changing mode.');
    mountedDraft.setMode('suggestion');

    const html = renderToStaticMarkup(<Harness />);
    const stored = JSON.parse(storage.getItem(storageKey) ?? '{}') as Record<string, unknown>;

    expect(Array.from(storage.values.keys())).toEqual([storageKey]);
    expect(stored.body).toBe('Body written before changing mode.');
    expect(stored.mode).toBe('suggestion');
    expect(stored.idempotencyKey).toBe('mode-toggle-key');
    expect(html).toContain('Body written before changing mode.');
  });

  it('clears drafts through the cancel and successful submit component paths', () => {
    const storage = installStorage(new TestStorage());
    const contextKey = commentDraftContextKey({
      documentId: 68,
      target: { type: 'document' },
    });
    const storageKey = commentDraftStorageKey(contextKey);
    const cancelDraft = renderDraft(contextKey, { generateIdempotencyKey: () => 'cancel-key' }).api;

    cancelDraft.setBody('Cancel this draft');
    clickComposerButton('Cancel', { body: 'Cancel this draft', onClose: cancelDraft.clear });

    expect(storage.getItem(storageKey)).toBeNull();
    expect(renderDraft(contextKey, { generateIdempotencyKey: () => 'after-cancel-key' }).api.idempotencyKey)
      .toBe('after-cancel-key');

    const submitDraft = renderDraft(contextKey, { generateIdempotencyKey: () => 'submit-key' }).api;
    submitDraft.setBody('Submit this draft');
    clickComposerButton('Post', { body: 'Submit this draft', onSubmit: submitDraft.clear });

    expect(storage.getItem(storageKey)).toBeNull();
    const next = renderDraft(contextKey, { generateIdempotencyKey: () => 'after-submit-key' }).api;
    expect(next.body).toBe('');
    expect(next.idempotencyKey).toBe('after-submit-key');
  });
});

describe('comment post retry regressions', () => {
  it('preserves document composer draft fields and idempotency key after createThread failure', async () => {
    const draft = {
      mode: 'document' as const,
      commentType: 'comment' as const,
      anchor: null,
      failedCapture: false,
      body: 'Body to retry',
      proposedText: 'Unused but preserved',
      idempotencyKey: 'document-retry-key',
    };
    const original = { ...draft };
    const createThread = vi.fn(async (
      _documentId: number,
      _input: CreateThreadInput,
    ): Promise<CreateThreadOutcome> => ({
      ok: false as const,
      kind: 'error' as const,
      message: 'Could not save this comment.',
    }));
    const createSuggestionThread = vi.fn();

    await postDocumentComposerDraft({ documentId: 67, draft, createThread, createSuggestionThread });
    await postDocumentComposerDraft({ documentId: 67, draft, createThread, createSuggestionThread });

    expect(draft).toEqual(original);
    expect(createThread).toHaveBeenCalledTimes(2);
    expect(createThread.mock.calls.map(([, input]) => input.idempotency_key)).toEqual([
      'document-retry-key',
      'document-retry-key',
    ]);
  });

  it('preserves reply draft fields and idempotency key after onReply failure', async () => {
    const thread = reviewThread();
    const draft = {
      commentType: 'suggestion' as const,
      body: 'Retry note',
      proposedText: 'Replacement copy',
      idempotencyKey: 'reply-retry-key',
    };
    const original = { ...draft };
    const onReply = vi.fn(async (
      _thread: ReviewThread,
      _input: ReplyToThreadInput,
      _idempotencyKey: string,
    ): Promise<string | null> => 'Could not save this reply.');

    await postReplyComposerDraft({ thread, draft, onReply });
    await postReplyComposerDraft({ thread, draft, onReply });

    expect(draft).toEqual(original);
    expect(onReply).toHaveBeenCalledTimes(2);
    expect(onReply.mock.calls.map(([, , idempotencyKey]) => idempotencyKey)).toEqual([
      'reply-retry-key',
      'reply-retry-key',
    ]);
    expect(onReply.mock.calls[0][1]).toEqual({
      comment_type: 'suggestion',
      body: 'Retry note',
      proposed_text: 'Replacement copy',
    });
  });
});

describe('fork idempotency guard', () => {
  it('suppresses a second in-flight fork and reuses the key after failure', () => {
    const keys = ['fork-key-1', 'fork-key-2'];
    const guard = createCommentForkGuard(() => keys.shift() ?? 'unexpected-key');

    const first = guard.start(501);
    const duplicate = guard.start(501);

    expect(first).toEqual({ started: true, idempotencyKey: 'fork-key-1' });
    expect(duplicate).toEqual({ started: false });
    expect(Array.from(guard.forkingCommentIds())).toEqual([501]);

    guard.finish(501, { posted: false });
    const retry = guard.start(501);
    expect(retry).toEqual({ started: true, idempotencyKey: 'fork-key-1' });

    guard.finish(501, { posted: true });
    const nextAction = guard.start(501);
    expect(nextAction).toEqual({ started: true, idempotencyKey: 'fork-key-2' });
  });
});

function installStorage<T extends TestStorage>(storage: T): T {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });

  return storage;
}

function inlineComposer(): ComposerState {
  return {
    open: true,
    stage: 'panel',
    mode: 'inline',
    anchor: {
      exact: 'Original text',
      prefix: '',
      suffix: '',
      start: 10,
      end: 23,
      heading_path: [],
      projection_version: 1,
    },
    failure: null,
    x: 100,
    y: 100,
  };
}

function clickComposerButton(
  label: string,
  overrides: Partial<{
    body: string;
    onClose: () => void;
    onSubmit: () => void;
  }>,
) {
  const element = renderedComposer({
    composer: { open: true, stage: 'panel', mode: 'document', anchor: null, failure: null, x: 0, y: 0 },
    body: overrides.body ?? '',
    onClose: overrides.onClose ?? (() => {}),
    onSubmit: overrides.onSubmit ?? (() => {}),
  });

  buttonByText(element, label).props.onClick();
}

function renderedComposer(overrides: Partial<Parameters<typeof DocumentCommentComposer>[0]>): ReactElement {
  const node = DocumentCommentComposer({
    documentId: 67,
    composer: { open: true, stage: 'panel', mode: 'document', anchor: null, failure: null, x: 0, y: 0 },
    commentType: 'comment',
    body: '',
    proposedText: '',
    message: null,
    submitting: false,
    onBodyChange: () => {},
    onProposedTextChange: () => {},
    onCommentTypeChange: () => {},
    onClose: () => {},
    onOpenPanel: () => {},
    onSubmit: () => {},
    ...overrides,
  });
  if (!isValidElement(node)) throw new Error('Composer did not render');

  return node;
}

function renderDraft(
  contextKey: string,
  options: UseCommentDraftOptions,
): { api: UseCommentDraftResult; markup: string } {
  let api: UseCommentDraftResult | null = null;

  function Harness() {
    api = useCommentDraft(contextKey, options);

    return (
      <span>
        {api.body}
        {api.proposedText}
        {api.mode}
        {api.idempotencyKey}
      </span>
    );
  }

  const markup = renderToStaticMarkup(<Harness />);
  if (!api) throw new Error('Hook did not render');

  return { api, markup };
}

function requireDraft(draft: UseCommentDraftResult | null): UseCommentDraftResult {
  if (!draft) throw new Error('Draft did not render');

  return draft;
}

function countDisabledAttributes(html: string): number {
  return html.match(/ disabled=""/g)?.length ?? 0;
}

function buttonByText(root: ReactElement, text: string): ReactElement<{ onClick: () => void }> {
  const button = findElement(root, (element) => element.type === 'button' && textContent(element).includes(text));
  if (!button) throw new Error(`Button "${text}" not found`);

  return button as ReactElement<{ onClick: () => void }>;
}

function textareaByPlaceholder(root: ReactElement, placeholder: string): ReactElement<{
  onChange: (event: { target: { value: string } }) => void;
}> {
  const textarea = findElement(
    root,
    (element) => element.type === 'textarea' && element.props.placeholder === placeholder,
  );
  if (!textarea) throw new Error(`Textarea "${placeholder}" not found`);

  return textarea as ReactElement<{ onChange: (event: { target: { value: string } }) => void }>;
}

function mentionTextareaByPlaceholder(root: ReactElement, placeholder: string): ReactElement<{
  onChange: (value: string) => void;
}> {
  const textarea = findElement(
    root,
    (element) => element.type === MentionTextarea && element.props.placeholder === placeholder,
  );
  if (!textarea) throw new Error(`Mention textarea "${placeholder}" not found`);

  return textarea as ReactElement<{ onChange: (value: string) => void }>;
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | null {
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<Record<string, unknown>>;
  if (predicate(element)) return element;
  if (typeof element.type === 'function' && element.type !== MentionTextarea) {
    const rendered = (element.type as (props: Record<string, unknown>) => ReactNode)(element.props);
    const result = findElement(rendered, predicate);
    if (result) return result;
  }

  for (const child of Children.toArray(element.props.children as ReactNode)) {
    const result = findElement(child, predicate);
    if (result) return result;
  }

  return null;
}

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement(node)) return '';
  const element = node as ReactElement<Record<string, unknown>>;

  return Children.toArray(element.props.children as ReactNode).map(textContent).join('');
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
    anchor: {
      id: 9,
      document_version_id: 3,
      exact: 'Original copy',
      prefix: '',
      suffix: '',
      start: 20,
      end: 33,
      heading_path: [],
      projection_version: '1',
      state: 'anchored',
    },
    first_comment: null,
    comments: [],
    can_resolve: true,
    can_reopen: false,
    created_at: null,
    updated_at: null,
  };
}
