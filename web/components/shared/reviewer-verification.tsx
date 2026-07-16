'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Mail, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  completeReviewerMagicLink,
  requestReviewerMagicLink,
  RETURN_COPY,
} from '@/lib/reviewer-identity-client';
import type { VerifyReturnState } from '@/lib/reviewer-verification-status';

export function ReviewerVerification({
  token,
  returnState,
  completionToken,
}: {
  token: string;
  returnState?: VerifyReturnState | null;
  completionToken?: string | null;
}) {
  const router = useRouter();
  const completionStarted = useRef(false);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'completing' | 'sending' | 'sent' | 'failed'>(
    completionToken ? 'completing' : 'idle',
  );
  const [message, setMessage] = useState<string | null>(returnState ? RETURN_COPY[returnState] : null);

  useEffect(() => {
    if (!completionToken || completionStarted.current) return;
    completionStarted.current = true;

    async function complete() {
      setState('completing');
      setMessage('Verifying your email...');
      const outcome = await completeReviewerMagicLink(token, completionToken!);

      if (outcome.ok) {
        router.replace(`/shared/${encodeURIComponent(token)}?verified=1`);
        router.refresh();
        return;
      }

      setState('failed');
      setMessage(outcome.message);
    }

    void complete();
  }, [completionToken, router, token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || state === 'sending' || state === 'completing') return;

    setState('sending');
    setMessage(null);
    const outcome = await requestReviewerMagicLink(token, trimmed);

    if (outcome.ok) {
      setState('sent');
      setMessage(outcome.message);
      return;
    }

    setState('failed');
    setMessage(outcome.message);
  }

  return (
    <aside className="mt-10 rounded-lg bg-white p-5 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
          <Mail className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
            Verify your email to comment
          </h2>
          <form onSubmit={(event) => void submit(event)} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              className="min-w-0 flex-1 rounded-lg border-0 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:text-white dark:ring-zinc-700"
            />
            <button
              type="submit"
              disabled={state === 'sending' || state === 'completing' || email.trim() === ''}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              {state === 'completing' ? 'Verifying' : state === 'sending' ? 'Sending' : state === 'sent' ? 'Sent' : 'Send link'}
            </button>
          </form>
          {message ? (
            <p className={state === 'failed' ? 'mt-2 text-sm text-rose-600 dark:text-rose-400' : 'mt-2 text-sm text-zinc-600 dark:text-zinc-400'}>
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
