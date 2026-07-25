'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Mail, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  completeReviewerMagicLink,
  requestReviewerMagicLink,
  type MagicLinkCompletionOutcome,
  type MagicLinkRequestOutcome,
} from '@/lib/reviewer-identity-client';
import type { VerifyReturnState } from '@/lib/reviewer-verification-status';

// Every visible string comes from the `shared` catalog (M3.9 #124). Outcome
// messages the API provided are shown as-is (untranslated pass-through, SPEC
// m3.9); when the lib reports a kind/status without prose, the localized
// fallback below applies.

const REQUEST_ERROR_KEYS: Record<
  Extract<MagicLinkRequestOutcome, { ok: false }>['kind'],
  string
> = {
  validation: 'verify.errors.validation',
  'rate-limited': 'verify.errors.rateLimited',
  gone: 'verify.errors.gone',
  'send-failed': 'verify.errors.sendFailed',
  error: 'verify.errors.sendFailed',
};

function completionErrorKey(
  status: Extract<MagicLinkCompletionOutcome, { ok: false }>['status'],
): string {
  switch (status) {
    case 'gone':
      return 'verify.errors.gone';
    case 'rate-limited':
      return 'verify.errors.completeRateLimited';
    case 'error':
      return 'verify.errors.completeFailed';
    default:
      return `verify.returnState.${status}`;
  }
}

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
  const t = useTranslations('shared');
  const completionStarted = useRef(false);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'completing' | 'sending' | 'sent' | 'failed'>(
    completionToken ? 'completing' : 'idle',
  );
  const [message, setMessage] = useState<string | null>(
    returnState ? t(`verify.returnState.${returnState}`) : null,
  );

  useEffect(() => {
    if (!completionToken || completionStarted.current) return;
    completionStarted.current = true;

    async function complete() {
      setState('completing');
      setMessage(t('verify.verifyingEmail'));
      const outcome = await completeReviewerMagicLink(token, completionToken!);

      if (outcome.ok) {
        router.replace(`/shared/${encodeURIComponent(token)}?verified=1`);
        router.refresh();
        return;
      }

      setState('failed');
      setMessage(outcome.message ?? t(completionErrorKey(outcome.status)));
    }

    void complete();
  }, [completionToken, router, t, token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || state === 'sending' || state === 'completing') return;

    setState('sending');
    setMessage(null);
    const outcome = await requestReviewerMagicLink(token, trimmed);

    if (outcome.ok) {
      setState('sent');
      setMessage(outcome.message ?? t('verify.sentFallback'));
      return;
    }

    setState('failed');
    setMessage(outcome.message ?? t(REQUEST_ERROR_KEYS[outcome.kind]));
  }

  return (
    <aside className="mt-10 rounded-2xl bg-white p-5 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
          <Mail className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
            {t('verify.heading')}
          </h2>
          <form onSubmit={(event) => void submit(event)} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              aria-label={t('verify.emailLabel')}
              className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-900/10 placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-white/10"
            />
            <button
              type="submit"
              disabled={state === 'sending' || state === 'completing' || email.trim() === ''}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              {state === 'completing'
                ? t('verify.verifying')
                : state === 'sending'
                  ? t('verify.sending')
                  : state === 'sent'
                    ? t('verify.sent')
                    : t('verify.send')}
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
