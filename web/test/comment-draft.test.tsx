import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  commentDraftContextKey,
  commentDraftStorageKey,
  resetCommentDraftMemoryForTests,
  useCommentDraft,
  type UseCommentDraftOptions,
  type UseCommentDraftResult,
} from '@/lib/comment-draft';

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

class ThrowingStorage {
  getItem(): string | null {
    throw new Error('storage unavailable');
  }

  setItem(): void {
    throw new Error('storage unavailable');
  }

  removeItem(): void {
    throw new Error('storage unavailable');
  }
}

afterEach(() => {
  resetCommentDraftMemoryForTests();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
});

describe('useCommentDraft', () => {
  it('persists text changes and restores them for the same context', () => {
    const storage = installStorage(new TestStorage());
    const contextKey = commentDraftContextKey({
      documentId: 17,
      target: { type: 'document' },
    });
    const storageKey = commentDraftStorageKey(contextKey);
    const first = renderDraft(contextKey, { generateIdempotencyKey: () => 'idem-1' }).api;

    first.setBody('Half-written review note');
    first.setProposedText('Replacement text');

    expect(JSON.parse(storage.getItem(storageKey) ?? '{}')).toEqual({
      body: 'Half-written review note',
      proposedText: 'Replacement text',
      mode: 'comment',
      idempotencyKey: 'idem-1',
    });

    const restored = renderDraft(contextKey, { generateIdempotencyKey: () => 'idem-2' }).api;

    expect(restored.body).toBe('Half-written review note');
    expect(restored.proposedText).toBe('Replacement text');
    expect(restored.mode).toBe('comment');
    expect(restored.idempotencyKey).toBe('idem-1');
  });

  it('restores a mounted draft from localStorage', () => {
    const storage = installStorage(new TestStorage());
    const contextKey = commentDraftContextKey({
      documentId: 22,
      target: { type: 'thread', threadId: 9 },
    });
    storage.setItem(commentDraftStorageKey(contextKey), JSON.stringify({
      body: 'Why this wording?',
      proposedText: 'Use the sharper phrase.',
      mode: 'suggestion',
      idempotencyKey: 'existing-key',
    }));

    const restored = renderDraft(contextKey, {
      initialProposedText: 'Original text',
      generateIdempotencyKey: () => 'new-key',
    }).api;

    expect(restored.body).toBe('Why this wording?');
    expect(restored.proposedText).toBe('Use the sharper phrase.');
    expect(restored.mode).toBe('suggestion');
    expect(restored.idempotencyKey).toBe('existing-key');
  });

  it('clears persisted state and starts the next draft with a fresh idempotency key', () => {
    const storage = installStorage(new TestStorage());
    const contextKey = commentDraftContextKey({
      documentId: 31,
      target: {
        type: 'anchor',
        anchor: { exact: 'selected phrase', start: 40, end: 55, projection_version: 3 },
      },
    });
    const storageKey = commentDraftStorageKey(contextKey);
    const first = renderDraft(contextKey, { generateIdempotencyKey: () => 'first-key' }).api;

    first.setBody('Draft to clear');
    first.clear();

    expect(storage.getItem(storageKey)).toBeNull();

    const next = renderDraft(contextKey, { generateIdempotencyKey: () => 'second-key' }).api;

    expect(next.body).toBe('');
    expect(next.proposedText).toBe('');
    expect(next.mode).toBe('comment');
    expect(next.idempotencyKey).toBe('second-key');
  });

  it('keeps one idempotency key for the lifetime of a draft across reloads', () => {
    installStorage(new TestStorage());
    const contextKey = commentDraftContextKey({
      documentId: 41,
      target: { type: 'thread', threadId: 12 },
    });
    const draft = renderDraft(contextKey, { generateIdempotencyKey: () => 'stable-key' }).api;

    draft.setBody('Retry this after a timeout');

    const retry = renderDraft(contextKey, { generateIdempotencyKey: () => 'different-key' }).api;

    expect(retry.body).toBe('Retry this after a timeout');
    expect(retry.mode).toBe('comment');
    expect(retry.idempotencyKey).toBe('stable-key');
  });

  it('keeps one storage key and one idempotency key across mode toggles', () => {
    const storage = installStorage(new TestStorage());
    const contextKey = commentDraftContextKey({
      documentId: 43,
      target: { type: 'thread', threadId: 14 },
    });
    const storageKey = commentDraftStorageKey(contextKey);
    const draft = renderDraft(contextKey, { generateIdempotencyKey: () => 'toggle-key' }).api;

    draft.setBody('The explanatory body survives.');
    draft.setMode('suggestion');

    expect(storage.getItem(storageKey)).not.toBeNull();
    expect(Array.from(storage.values.keys())).toEqual([storageKey]);

    const restored = renderDraft(contextKey, { generateIdempotencyKey: () => 'new-key' }).api;

    expect(restored.body).toBe('The explanatory body survives.');
    expect(restored.mode).toBe('suggestion');
    expect(restored.idempotencyKey).toBe('toggle-key');
  });

  it('falls back to a fresh draft for corrupted stored JSON', () => {
    const storage = installStorage(new TestStorage());
    const contextKey = commentDraftContextKey({
      documentId: 44,
      target: { type: 'document' },
    });
    storage.setItem(commentDraftStorageKey(contextKey), '{not json');

    const draft = renderDraft(contextKey, {
      generateIdempotencyKey: () => 'fresh-after-corruption',
    }).api;

    expect(draft.body).toBe('');
    expect(draft.proposedText).toBe('');
    expect(draft.mode).toBe('comment');
    expect(draft.idempotencyKey).toBe('fresh-after-corruption');
  });

  it('falls back to a fresh draft for wrong-shaped stored JSON', () => {
    const storage = installStorage(new TestStorage());
    const contextKey = commentDraftContextKey({
      documentId: 45,
      target: { type: 'document' },
    });
    storage.setItem(commentDraftStorageKey(contextKey), JSON.stringify({ body: 123 }));

    const draft = renderDraft(contextKey, {
      generateIdempotencyKey: () => 'fresh-after-shape',
    }).api;

    expect(draft.body).toBe('');
    expect(draft.proposedText).toBe('');
    expect(draft.mode).toBe('comment');
    expect(draft.idempotencyKey).toBe('fresh-after-shape');
  });

  it('falls back to in-memory drafts when localStorage is unavailable', () => {
    installStorage(new ThrowingStorage());
    const contextKey = commentDraftContextKey({
      documentId: 51,
      target: { type: 'document' },
    });
    const draft = renderDraft(contextKey, { generateIdempotencyKey: () => 'memory-key' }).api;

    expect(() => draft.setBody('Storage should not be required')).not.toThrow();

    const restored = renderDraft(contextKey, { generateIdempotencyKey: () => 'unused-key' }).api;

    expect(restored.body).toBe('Storage should not be required');
    expect(restored.mode).toBe('comment');
    expect(restored.idempotencyKey).toBe('memory-key');

    restored.clear();

    const cleared = renderDraft(contextKey, { generateIdempotencyKey: () => 'fresh-memory-key' }).api;
    expect(cleared.body).toBe('');
    expect(cleared.mode).toBe('comment');
    expect(cleared.idempotencyKey).toBe('fresh-memory-key');
  });
});

function installStorage<T extends TestStorage | ThrowingStorage>(storage: T): T {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });

  return storage;
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
