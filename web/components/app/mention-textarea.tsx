'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { listMentionSuggestions } from '@/lib/comments-client';
import { findMentionTrigger, insertMentionToken, type MentionTrigger } from '@/lib/mention-tokens';
import type { MentionCandidate } from '@/lib/thread-types';

export function MentionTextarea({
  documentId,
  value,
  onChange,
  rows,
  className,
  placeholder,
  ariaLabel,
  disabled = false,
}: {
  documentId: number;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  className: string;
  placeholder: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const listboxId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const open = trigger !== null && candidates.length > 0 && !disabled;

  useEffect(() => {
    if (trigger === null || disabled) {
      setCandidates([]);
      return;
    }

    const controller = new AbortController();
    void listMentionSuggestions(documentId, trigger.query, controller.signal)
      .then((next) => {
        setCandidates(next);
        setActiveIndex(0);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCandidates([]);
      });

    return () => controller.abort();
  }, [disabled, documentId, trigger?.query, trigger?.start]);

  function updateTrigger(nextValue = value, caret = textareaRef.current?.selectionStart ?? nextValue.length) {
    if (disabled) {
      setTrigger(null);
      return;
    }

    setTrigger(findMentionTrigger(nextValue, caret));
  }

  function choose(candidate: MentionCandidate) {
    if (trigger === null || disabled) return;
    const next = insertMentionToken(value, trigger, candidate);
    onChange(next.value);
    setTrigger(null);
    setCandidates([]);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % candidates.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      choose(candidates[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setTrigger(null);
      setCandidates([]);
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          updateTrigger(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => updateTrigger(event.currentTarget.value, event.currentTarget.selectionStart)}
        onClick={(event) => updateTrigger(event.currentTarget.value, event.currentTarget.selectionStart)}
        rows={rows}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-${candidates[activeIndex]?.id}` : undefined}
      />
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:ring-white/10"
        >
          {candidates.map((candidate, index) => (
            <button
              key={candidate.id}
              id={`${listboxId}-${candidate.id}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(candidate);
              }}
              className={[
                'block w-full px-3 py-1.5 text-left text-xs',
                index === activeIndex
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/5',
              ].join(' ')}
            >
              @{candidate.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
