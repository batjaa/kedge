'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { AnchorSelector } from './anchor-capture-core';
import type { CommentType } from './thread-types';

export interface CommentDraftValue {
  body: string;
  proposedText: string;
  mode: CommentType;
  idempotencyKey: string;
}

export interface UseCommentDraftResult extends CommentDraftValue {
  setBody: (body: string) => void;
  setProposedText: (proposedText: string) => void;
  setMode: (mode: CommentType) => void;
  clear: () => void;
}

export type CommentDraftTarget =
  | { type: 'document' }
  | { type: 'thread'; threadId: number }
  | { type: 'anchor'; anchor: Pick<AnchorSelector, 'exact' | 'start' | 'end' | 'projection_version'> };

export interface CommentDraftContext {
  documentId: number;
  target: CommentDraftTarget;
}

export interface UseCommentDraftOptions {
  initialBody?: string;
  initialProposedText?: string;
  initialMode?: CommentType;
  generateIdempotencyKey?: () => string;
}

const STORAGE_PREFIX = 'kedge:comment-draft:v2';
const memoryDrafts = new Map<string, CommentDraftValue>();

export function commentDraftContextKey(context: CommentDraftContext): string {
  return `doc:${context.documentId}:${targetKey(context.target)}`;
}

export function commentDraftStorageKey(contextKey: string): string {
  return `${STORAGE_PREFIX}:${contextKey}`;
}

export function newCommentDraftIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useCommentDraft(
  contextKey: string | null,
  options: UseCommentDraftOptions = {},
): UseCommentDraftResult {
  const storageKey = useMemo(() => contextKey ? commentDraftStorageKey(contextKey) : null, [contextKey]);
  const initialBody = options.initialBody ?? '';
  const initialProposedText = options.initialProposedText ?? '';
  const initialMode = options.initialMode ?? 'comment';
  const generateIdempotencyKey = options.generateIdempotencyKey ?? newCommentDraftIdempotencyKey;
  const loadedDraft = useMemo(
    () => storageKey
      ? readCommentDraft(storageKey) ?? newDraft(initialBody, initialProposedText, initialMode, generateIdempotencyKey)
      : newDraft(initialBody, initialProposedText, initialMode, generateIdempotencyKey),
    [generateIdempotencyKey, initialBody, initialMode, initialProposedText, storageKey],
  );
  const [state, setState] = useState<{ storageKey: string | null; draft: CommentDraftValue }>(() => ({
    storageKey,
    draft: loadedDraft,
  }));
  const draft = state.storageKey === storageKey ? state.draft : loadedDraft;
  const draftRef = useRef(draft);
  const storageKeyRef = useRef(storageKey);
  const optionsRef = useRef({ initialBody, initialProposedText, initialMode, generateIdempotencyKey });

  draftRef.current = draft;
  storageKeyRef.current = storageKey;
  optionsRef.current = { initialBody, initialProposedText, initialMode, generateIdempotencyKey };

  const update = useCallback((patch: Partial<Pick<CommentDraftValue, 'body' | 'proposedText' | 'mode'>>) => {
    const key = storageKeyRef.current;
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    if (key) writeCommentDraft(key, next);
    setState({ storageKey: key, draft: next });
  }, []);

  const clear = useCallback(() => {
    const key = storageKeyRef.current;
    if (key) clearCommentDraft(key);
    const next = newDraft(
      optionsRef.current.initialBody,
      optionsRef.current.initialProposedText,
      optionsRef.current.initialMode,
      optionsRef.current.generateIdempotencyKey,
    );
    draftRef.current = next;
    setState({ storageKey: key, draft: next });
  }, []);

  return {
    ...draft,
    setBody: (body) => update({ body }),
    setProposedText: (proposedText) => update({ proposedText }),
    setMode: (mode) => update({ mode }),
    clear,
  };
}

export function resetCommentDraftMemoryForTests(): void {
  memoryDrafts.clear();
}

function targetKey(target: CommentDraftTarget): string {
  if (target.type === 'document') return 'target:document';
  if (target.type === 'thread') return `target:thread:${target.threadId}`;

  return [
    'target:anchor',
    String(target.anchor.projection_version),
    String(target.anchor.start),
    String(target.anchor.end),
    hashString(target.anchor.exact),
  ].join(':');
}

function newDraft(
  body: string,
  proposedText: string,
  mode: CommentType,
  generateIdempotencyKey: () => string,
): CommentDraftValue {
  return {
    body,
    proposedText,
    mode,
    idempotencyKey: generateIdempotencyKey(),
  };
}

function readCommentDraft(storageKey: string): CommentDraftValue | null {
  try {
    const value = globalThis.localStorage?.getItem(storageKey);
    if (value == null) return memoryDrafts.get(storageKey) ?? null;

    return parseCommentDraft(value);
  } catch {
    return memoryDrafts.get(storageKey) ?? null;
  }
}

function writeCommentDraft(storageKey: string, draft: CommentDraftValue): void {
  memoryDrafts.set(storageKey, draft);
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(draft));
  } catch {
    // Private browsing and disabled storage still keep the draft for this tab.
  }
}

function clearCommentDraft(storageKey: string): void {
  memoryDrafts.delete(storageKey);
  try {
    globalThis.localStorage?.removeItem(storageKey);
  } catch {
    // The in-memory copy is already cleared.
  }
}

function parseCommentDraft(value: string): CommentDraftValue | null {
  try {
    const parsed = JSON.parse(value) as Partial<CommentDraftValue> | null;
    if (
      parsed
      && typeof parsed.body === 'string'
      && typeof parsed.proposedText === 'string'
      && isCommentType(parsed.mode)
      && typeof parsed.idempotencyKey === 'string'
    ) {
      return {
        body: parsed.body,
        proposedText: parsed.proposedText,
        mode: parsed.mode,
        idempotencyKey: parsed.idempotencyKey,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function isCommentType(value: unknown): value is CommentType {
  return value === 'comment' || value === 'suggestion';
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}
