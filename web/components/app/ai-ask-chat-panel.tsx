'use client';

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { MessageCircleQuestion, RefreshCw, Send, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  AI_SURFACE_LABEL_CLASS,
  AI_SURFACE_TONE_CLASS,
  AI_TONE_CLASS,
} from './ai-tone';
import { MAX_ASK_QUESTION_CHARS, askQuestionIsAskable, askQuotePreview } from '@/lib/ai-ask';
import { aiRunPhase } from '@/lib/ai-run';
import {
  askTurnIsPending,
  askTurnIsRetryable,
  askTurnOutput,
  type AskTurn,
} from '@/lib/ask-conversation';
import type { AskConversation } from '@/lib/use-ask-conversation';
import { cn } from '@/lib/cn';

/**
 * Ask AI, as a conversation docked to the review rail (SPEC §14, M4 #151).
 *
 * #139 shipped this as a full-screen modal, single-turn: asking again replaced
 * the answer and closing threw everything away. In practice the first answer is
 * what prompts the real question, and a modal that covers the document is the
 * worst possible place to read an answer ABOUT that document. So the panel now
 * takes the rail column — the familiar chat-agent shape, beside the prose rather
 * than on top of it — and the turns accumulate.
 *
 * **It owns no conversation state.** The turns live in the surface
 * (`useAskConversation`), because this component unmounts every time the panel
 * closes and the conversation must survive that. Everything here is rendering
 * and one composer draft.
 *
 * **There is still no write path** (hard rule 5). Every affordance in this file
 * either sends a question, retries one, copies text to the clipboard, or closes
 * the panel. Nothing posts, and no api endpoint exists that could.
 */

/**
 * Which shell the conversation gets, reactively.
 *
 * A media QUERY rather than a media-query utility class, because the sheet has
 * real side effects — it locks body scroll and claims the document's Escape
 * key. Rendered-but-`xl:hidden`, it would lock scrolling on a desktop where it
 * is not even visible. So the shells are mounted exclusively, and the CSS
 * classes below are only belt-and-braces for the first frame.
 *
 * `false` on the server and on the first client render, matching the rail-first
 * layout; the panel is never open during SSR, so there is no mismatch to
 * hydrate through.
 */
export function useAskChatIsSheet(): boolean {
  const [isSheet, setIsSheet] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    // Matches Tailwind's `xl` breakpoint and the surface's MOBILE_BREAKPOINT.
    const query = window.matchMedia('(max-width: 1279.98px)');
    const sync = () => setIsSheet(query.matches);

    sync();
    query.addEventListener('change', sync);

    return () => query.removeEventListener('change', sync);
  }, []);

  return isSheet;
}

/**
 * The rail occupant. Sticky under the measured header pin (#146) exactly as the
 * sidebar and thread rail are, and scrolling internally rather than growing the
 * page — a conversation is unbounded and the document behind it must not move.
 *
 * Its width is the grid cell's, so DESIGN.md's 320px / 360px-at-2xl rail
 * constraint is inherited rather than restated here.
 */
export function AiAskChatPanel({
  conversation,
  onClose,
}: {
  conversation: AskConversation;
  onClose: () => void;
}) {
  const t = useTranslations('ai-ask');
  const previousFocusRef = useOpenerFocus();

  // Focus restoration, lifted from AiArtifactDialog along with the Escape key —
  // the modal is gone, but the reader who opened this from a keyboard still has
  // to get back to where they were.
  useEffect(() => () => restoreFocus(previousFocusRef.current), [previousFocusRef]);

  return (
    <aside
      aria-label={t('panelLabel')}
      // Escape is scoped to this subtree rather than to the document. The panel
      // is DOCKED, not modal: it does not cover the page, so a global handler
      // would steal Escape from whatever the reader is actually working in.
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      className="sticky top-[var(--kedge-pin-top,8rem)] hidden w-full flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-900/10 xl:flex dark:bg-zinc-950 dark:ring-white/10"
      // A calc over the measured pin variable. Written as a style rather than an
      // arbitrary utility on purpose: a `var()` nested inside a `calc()` inside
      // a bracketed class is exactly the construct that has taken this build
      // down before, and the value is dynamic anyway (see the surface's own
      // --kedge-pin-top assignment).
      //
      // HEIGHT, not max-height. Under max-height a short conversation
      // shrink-wraps and the composer rides up under the last answer, jumping
      // down the page as turns accumulate. A fixed height keeps it pinned to the
      // bottom of the rail where the reader left it.
      style={{ height: 'calc(100vh - var(--kedge-pin-top, 8rem) - 2rem)' }}
    >
      <AskChatBody conversation={conversation} onClose={onClose} autoFocus />
    </aside>
  );
}

/**
 * Below `xl` the rail does not exist, so the same conversation presents as a
 * slide-over sheet — the `MobileThreadSheet` pattern, including its focus trap,
 * its body-scroll lock and its document-level Escape.
 *
 * Modal here where the rail panel is not, and that difference is the point: a
 * sheet DOES cover the document, so trapping focus inside it is correct rather
 * than rude.
 */
export function AiAskChatSheet({
  conversation,
  onClose,
}: {
  conversation: AskConversation;
  onClose: () => void;
}) {
  const t = useTranslations('ai-ask');
  const previousFocusRef = useOpenerFocus();

  // `onClose` through a ref so this effect depends on nothing: with the callback
  // in the dependency list an inline arrow from the parent re-runs it every
  // render, and the cleanup would restore focus while the sheet is still open —
  // the caret yanked out mid-sentence (the bug AiArtifactDialog documents).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current();
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocus(previousFocusRef.current);
    };
  }, [previousFocusRef]);

  return (
    <div className="fixed inset-0 z-50 xl:hidden">
      <button
        type="button"
        aria-label={t('close')}
        className="absolute inset-0 cursor-default bg-zinc-900/45"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('panelLabel')}
        tabIndex={-1}
        onKeyDown={trapFocus}
        className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl bg-white shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:ring-white/10"
      >
        <AskChatBody conversation={conversation} onClose={onClose} autoFocus />
      </div>
    </div>
  );
}

/**
 * Panel header, scrolling transcript, composer pinned at the bottom.
 *
 * Exported for the component tests, which render it directly: the two shells
 * above differ only in how they are positioned, and asserting the register and
 * the affordances twice would prove nothing extra.
 */
export function AskChatBody({
  conversation,
  onClose,
  autoFocus = false,
}: {
  conversation: AskConversation;
  onClose: () => void;
  autoFocus?: boolean;
}) {
  const t = useTranslations('ai-ask');
  const [draft, setDraft] = useState('');
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const { turns, pendingQuote, busy } = conversation;

  useEffect(() => {
    if (autoFocus) composerRef.current?.focus();
  }, [autoFocus]);

  // Follow the conversation as it grows. Keyed on the turn count and the
  // busy flag so it also fires when an answer lands, not only when a question
  // is added.
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcript.scrollTop = transcript.scrollHeight;
  }, [turns.length, busy]);

  const sendable = askQuestionIsAskable(draft) && !busy;

  function send() {
    if (!sendable) return;
    // Cleared only if the conversation actually took it. A send racing a "New
    // conversation" is refused, and wiping the draft anyway would delete a
    // question the reader watched vanish without ever being asked.
    if (conversation.ask(draft)) setDraft('');
  }

  function startNewConversation() {
    conversation.reset();
    // The button that was just clicked disappears with the transcript, so focus
    // would fall to <body>. Send the reader to the composer instead — the one
    // thing a fresh conversation is for.
    composerRef.current?.focus();
  }

  const quotePreview = pendingQuote ? askQuotePreview(pendingQuote.exact) : null;

  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-900/10 px-3 py-2.5 dark:border-white/10">
        <MessageCircleQuestion
          className={cn('h-4 w-4 shrink-0', AI_SURFACE_LABEL_CLASS)}
          aria-hidden="true"
        />
        <h2 className="font-display truncate text-sm font-semibold text-zinc-900 dark:text-white">
          {t('panelTitle')}
        </h2>

        {turns.length > 0 ? (
          <button
            type="button"
            onClick={startNewConversation}
            className="ml-auto rounded-full px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100"
          >
            {t('newConversation')}
          </button>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className={cn(
            'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-white/5 dark:hover:text-zinc-200',
            turns.length > 0 ? '' : 'ml-auto',
          )}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div ref={transcriptRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 p-3 text-xs leading-5 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            {t('description')}
          </p>
        ) : null}

        {turns.map((turn) => (
          <AskTurnView
            key={turn.id}
            turn={turn}
            // The same predicate the hook guards `retry` with, so the button
            // can never appear on a turn the hook would refuse.
            retryable={askTurnIsRetryable(turns, turn.id)}
            onRetry={() => conversation.retry(turn.id)}
          />
        ))}
      </div>

      <div className="border-t border-zinc-900/10 px-3 py-2.5 dark:border-white/10">
        {quotePreview ? (
          <div className="mb-2 flex items-start gap-2 rounded-xl bg-zinc-100 px-2.5 py-1.5 dark:bg-white/5">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {t('selectedPassage')}
              </p>
              <p className="mt-0.5 line-clamp-3 text-xs leading-5 text-zinc-700 dark:text-zinc-300">
                {quotePreview}
              </p>
            </div>
            <button
              type="button"
              onClick={conversation.clearPendingQuote}
              aria-label={t('removePassage')}
              className="shrink-0 rounded-full p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-white/10 dark:hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <textarea
          ref={composerRef}
          rows={2}
          aria-label={t('questionLabel')}
          maxLength={MAX_ASK_QUESTION_CHARS}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line — the chat convention.
            // `isComposing` keeps an IME's own Enter (committing a candidate)
            // from firing the question half-typed.
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            send();
          }}
          placeholder={t('placeholder')}
          className="block w-full resize-none rounded-lg border-0 bg-zinc-50 p-2.5 text-sm leading-6 text-zinc-900 ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-zinc-700"
        />

        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">{t('ephemeralHint')}</p>
          <button
            type="button"
            onClick={send}
            disabled={!sendable}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60',
              AI_TONE_CLASS,
            )}
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            {busy ? t('asking') : t('send')}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * One turn: what the reader asked, then what came back.
 *
 * The human half is zinc and the model half is violet, in both themes (#143).
 * Every state an answer can be in renders HERE rather than as a panel-level
 * banner, because in a conversation "which question failed?" is a real question
 * — a run that failed three turns ago must not look like the current one did.
 */
function AskTurnView({
  turn,
  retryable,
  onRetry,
}: {
  turn: AskTurn;
  retryable: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('ai-ask');
  const [now, setNow] = useState(() => Date.now());
  const pending = askTurnIsPending(turn);

  useEffect(() => {
    if (!pending) return;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [pending, turn.run?.id]);

  const phase = turn.run === null ? 'idle' : aiRunPhase(turn.run, now);
  const output = askTurnOutput(turn);
  const quotePreview = turn.quote ? askQuotePreview(turn.quote.exact) : null;

  return (
    <article className="space-y-2" data-ask-turn={turn.id}>
      <div className="rounded-xl bg-zinc-100 px-3 py-2 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:ring-white/10">
        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t('you')}
        </p>
        {quotePreview ? (
          <blockquote className="mt-1 border-l-2 border-zinc-300 pl-2 text-[11px] leading-5 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
            {quotePreview}
          </blockquote>
        ) : null}
        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-800 dark:text-zinc-100">
          {turn.question}
        </p>
      </div>

      <div className={cn('rounded-xl px-3 py-2', AI_SURFACE_TONE_CLASS)}>
        <p className={cn('text-[10px] font-medium uppercase tracking-wide', AI_SURFACE_LABEL_CLASS)}>
          {t('assistant')}
        </p>

        {pending && phase !== 'taking-too-long' ? (
          <p role="status" className={cn('mt-1 text-sm leading-6', AI_SURFACE_LABEL_CLASS)}>
            {t('asking')}
          </p>
        ) : null}

        {/* Past the client's ceiling the run may never land at all — a worker
            killed hard enough never runs its terminal handler, so nothing will
            ever settle this poll. The retry is what unwedges it: it drops the
            stale run id, which stops the poll and starts a fresh run. Without
            it the composer stays disabled until the reader throws the whole
            conversation away. */}
        {phase === 'taking-too-long' ? (
          <div className="mt-1 space-y-2">
            <p role="status" className="text-sm leading-6 text-amber-700 dark:text-amber-300">
              {t('takingTooLong')}
            </p>
            {retryable ? <AskRetryButton onRetry={onRetry} /> : null}
          </div>
        ) : null}

        {output ? (
          <>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-800 dark:text-zinc-100">
              {output.answer}
            </p>
            {/* The run's own sentence, verbatim — a long document read only in
                part says so in its own words, and a conversation that squeezed
                the document says that too. Never re-derived here. */}
            <p className="mt-2 text-[11px] leading-5 text-zinc-600 dark:text-zinc-300">
              {output.coverage.statement}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <AskTurnCopy answer={output.answer} />
              {/* Which model wrote this, where the answer is — the ledger is not
                  reachable from here, and "a model wrote this" is only half the
                  disclosure if it never says which. */}
              {turn.run?.model ? (
                <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                  {turn.run.model}
                </span>
              ) : null}
            </div>
          </>
        ) : null}

        {phase === 'failed' || turn.startFailure ? (
          <AskTurnFailure turn={turn} retryable={retryable} onRetry={onRetry} />
        ) : null}
      </div>
    </article>
  );
}

/**
 * Why this turn has no answer, and what can be done about it.
 *
 * The deterministic/transient split is the thing worth getting right: a retry
 * that cannot possibly work is worse than no button, because it spends the
 * workspace's key to show the same sentence again. A 429 is its own case — it
 * is not the turn's fault and it WILL work shortly, so it says so in the chat
 * instead of leaving a dead panel.
 */
function AskTurnFailure({
  turn,
  retryable,
  onRetry,
}: {
  turn: AskTurn;
  retryable: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('ai-ask');
  const startFailure = turn.startFailure;
  const runError = turn.run?.error ?? null;

  const message = startFailure?.kind === 'rate-limited'
    ? t('rateLimited')
    : startFailure?.message ?? runError?.message ?? t('failed');

  // Deterministic run failures cannot be retried into a different answer, and
  // "AI is not enabled here" cannot either. Everything else can — provided the
  // turn is the conversation's last, which is the caller's half of the rule.
  const canRetry = retryable
    && runError?.kind !== 'deterministic'
    && startFailure?.kind !== 'unavailable'
    && startFailure?.kind !== 'forbidden';

  return (
    <div className="mt-1 space-y-2">
      <p role="alert" className="text-sm leading-6 text-rose-700 dark:text-rose-300">
        {message}
      </p>
      {canRetry ? <AskRetryButton onRetry={onRetry} /> : null}
    </div>
  );
}

/**
 * Retry one turn — and therefore start a model run, which is why it wears the
 * agent register rather than the neutral zinc a Copy gets. DESIGN.md's rule is
 * about what the click LEADS TO, and this leads to a run (#143).
 */
function AskRetryButton({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('ai-ask');

  return (
    <button
      type="button"
      onClick={onRetry}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
        AI_TONE_CLASS,
      )}
    >
      <RefreshCw className="h-3 w-3" aria-hidden="true" />
      {t('retry')}
    </button>
  );
}

/**
 * Copy one answer. Zinc, never the agent register: copying to the clipboard runs
 * no model and writes nothing, so it must not borrow the colour that says one is
 * about to run (#143).
 */
function AskTurnCopy({ answer }: { answer: string }) {
  const t = useTranslations('ai-ask');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(answer);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('failed');
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="rounded-full px-2 py-1 text-[11px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-900/10 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10"
    >
      {state === 'copied' ? t('copied') : state === 'failed' ? t('copyFailed') : t('copy')}
    </button>
  );
}

/**
 * Remember what had focus when the panel opened, captured during the FIRST
 * RENDER rather than in an effect.
 *
 * Timing is the whole point. Child effects run before parent effects, so the
 * composer's autofocus fires first and an effect here would record the
 * textarea as "what had focus before" — closing the panel would then try to
 * return focus to a node it had just unmounted. Render happens before any
 * effect, so this catches the actual opener.
 */
function useOpenerFocus() {
  const ref = useRef<HTMLElement | null | undefined>(undefined);

  if (ref.current === undefined) {
    ref.current = typeof document === 'undefined' || !(document.activeElement instanceof HTMLElement)
      ? null
      : document.activeElement;
  }

  return ref as { current: HTMLElement | null };
}

/**
 * Hand focus back, but only if there is still somewhere to hand it.
 *
 * The opener is often gone by the time the panel closes — the selection popover
 * that carried the Ask pill unmounts the moment the panel opens. Focusing a
 * detached node silently drops focus to `<body>`, so leaving it where the
 * browser put it is the better of the two.
 */
function restoreFocus(element: HTMLElement | null) {
  if (element?.isConnected) element.focus();
}

function trapFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const focusables = focusableElements(event.currentTarget);
  if (focusables.length === 0) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
}
