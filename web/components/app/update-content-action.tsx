'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FilePenLine, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { runContentUpdate } from '@/lib/content-update';
import { updateDocumentContent } from '@/lib/documents-client';
import { refreshSurfaceAfterResync, waitForResyncCompletion } from '@/lib/resync-polling';

// The manual-versioning affordance for a pasted/uploaded document (#113): an
// "Update content" button that opens a paste surface (the Markdown body — the
// title is preserved server-side, so this surface versions the body only).
// Submitting re-pastes the body, which mints a new version through the same
// pipeline a re-sync uses — the orchestration and its exhaustive outcomes live in
// lib/content-update.ts; this component only owns the dialog + its transient
// state. DESIGN.md tokens only.
const BUTTON_CLASS =
  'inline-flex items-center gap-2 rounded-full bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15';

export function UpdateContentAction({
  documentId,
  currentVersionLabel,
  refreshThreads,
  onServerRefresh,
}: {
  documentId: number;
  currentVersionLabel: string | null;
  refreshThreads: () => Promise<void>;
  onServerRefresh: () => void;
}) {
  const t = useTranslations('update-content');
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => textareaRef.current?.focus(), 0);

    function onKeyDown(event: globalThis.KeyboardEvent) {
      // Reads only the ref + stable setters, so the effect need re-subscribe only
      // when `open` flips — never per render.
      if (event.key === 'Escape' && !submittingRef.current) {
        setOpen(false);
        setError(null);
        setInfo(null);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open]);

  function close() {
    if (submittingRef.current) return;
    setOpen(false);
    setError(null);
    setInfo(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (content.trim() === '') {
      setError(t('errorEmpty'));
      return;
    }

    submittingRef.current = true;
    setPending(true);
    setError(null);
    setInfo(null);

    try {
      const result = await runContentUpdate({
        documentId,
        content,
        startingVersionLabel: currentVersionLabel,
        update: updateDocumentContent,
        waitForCompletion: waitForResyncCompletion,
        onAdvanced: () => refreshSurfaceAfterResync(refreshThreads, onServerRefresh),
        onServerRefresh,
      });

      if (result.status === 'advanced') {
        // A new version landed and the surface refreshed: reset and dismiss.
        setContent('');
        setOpen(false);
        return;
      }

      if (result.status === 'unchanged') {
        setInfo(result.message);
        return;
      }

      setError(result.message);
    } catch {
      setError(t('errorGeneric'));
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  const fieldRing = error
    ? 'ring-rose-500/50 focus-visible:ring-rose-500'
    : 'ring-zinc-900/10 focus-visible:ring-emerald-500 dark:ring-white/10';

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        <FilePenLine className="h-4 w-4" aria-hidden="true" />
        {t('trigger')}
      </button>

      {/* Portaled to <body>: the trigger sits inside the sticky header, whose
          backdrop-blur makes it the containing block for fixed descendants —
          rendered in place, this overlay would be confined to the header strip. */}
      {open ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('dialogLabel')}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6"
        >
          <button
            type="button"
            aria-label={t('close')}
            className="fixed inset-0 cursor-default bg-zinc-900/45"
            onClick={close}
          />

          <div className="relative z-10 mt-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-900 dark:ring-white/10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
                  {t('heading')}
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {t('description')}
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                aria-label={t('close')}
                className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:hover:bg-white/5 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={onSubmit} noValidate className="mt-4">
              <label
                htmlFor="update-content-body"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                {t('contentLabel')}
              </label>
              <textarea
                id="update-content-body"
                ref={textareaRef}
                name="content"
                rows={12}
                placeholder={t('placeholder')}
                value={content}
                onChange={(event) => {
                  setContent(event.target.value);
                  if (error) setError(null);
                  if (info) setInfo(null);
                }}
                aria-invalid={Boolean(error)}
                className={`mt-1.5 block w-full resize-y rounded-xl bg-white px-3.5 py-2 font-mono text-sm text-zinc-900 ring-1 ring-inset placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 dark:bg-white/[.03] dark:text-white ${fieldRing}`}
              />

              {error ? (
                <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                  {error}
                </p>
              ) : info ? (
                <p role="status" className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {info}
                </p>
              ) : null}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={pending}
                  className="rounded-full px-3.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-white/5"
                >
                  {t('cancel')}
                </button>
                <button type="submit" disabled={pending} className={BUTTON_CLASS}>
                  {pending ? t('submitting') : t('submit')}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
