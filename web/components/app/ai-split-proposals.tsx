'use client';

import { Check, Quote } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { approvedSplitCount, canApproveSplit, type SplitApprovals } from '@/lib/ai-split';
import type { SplitOutput } from '@/lib/ai-types';

/**
 * The split-proposal review list (SPEC §14 user story 6): one row per proposal —
 * title, the comment fragment it covers, and the document text it would anchor
 * to — each with its own approve action, plus approve-all.
 *
 * Presentational and state-free: every approval decision lives in the caller, so
 * this renders identically in the panel and in a test. The coverage sentence is
 * printed VERBATIM from the run, as everywhere else.
 *
 * A row that failed keeps its approve button. A proposed anchor is validated at
 * fork time, so one stale proposal must never take the rest of the list down
 * with it.
 */
export function AiSplitProposals({
  output,
  approvals,
  model,
  busy,
  onApprove,
  onApproveAll,
}: {
  output: SplitOutput;
  approvals: SplitApprovals;
  model: string | null;
  busy: boolean;
  onApprove: (index: number) => void;
  onApproveAll: () => void;
}) {
  const t = useTranslations('ai-split');
  const proposals = output.proposals ?? [];
  const approved = approvedSplitCount(approvals);
  const remaining = approvals.filter((approval) => canApproveSplit(approval)).length;

  return (
    <div>
      <p className="rounded-xl bg-zinc-100 px-3.5 py-2 text-xs text-zinc-600 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
        {output.coverage?.statement}
      </p>

      {proposals.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{t('noSplit')}</p>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t('approvedCount', { approved, total: proposals.length })}
            </p>
            {remaining > 0 ? (
              <button
                type="button"
                onClick={onApproveAll}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/5 dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-white/10"
              >
                {t('approveAll', { count: remaining })}
              </button>
            ) : null}
          </div>

          {/* Say plainly what approving does. The fork mechanism copies the
              whole comment into each new thread and differentiates them by
              anchor — the title and fragment below explain WHY each thread
              exists, they are not its body. Letting the panel imply otherwise
              would be an affordance that lies about its own effect. */}
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t('approvalEffect')}</p>

          <ul className="mt-3 space-y-3">
            {proposals.map((proposal, index) => {
              const approval = approvals[index] ?? { status: 'idle' as const, message: null };
              const isApproved = approval.status === 'approved';

              return (
                <li
                  key={`${proposal.title}-${index}`}
                  className={cn(
                    'rounded-xl p-3.5 ring-1 ring-inset',
                    isApproved
                      ? 'bg-emerald-500/5 ring-emerald-500/30'
                      : 'bg-white ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{proposal.title}</h3>
                    {isApproved ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('approved')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onApprove(index)}
                        disabled={busy || approval.status === 'approving'}
                        className="shrink-0 rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-1 dark:ring-inset dark:ring-violet-400/20 dark:hover:bg-violet-400/15"
                      >
                        {approval.status === 'approving' ? t('approving') : t('approve')}
                      </button>
                    )}
                  </div>

                  <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    {t('raisedIn')}
                  </p>
                  <p className="mt-0.5 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{proposal.fragment}</p>

                  <p className="mt-2.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    {t('anchorsTo')}
                  </p>
                  {proposal.anchor ? (
                    <p className="mt-0.5 flex items-start gap-1.5 border-l-2 border-emerald-500/40 pl-2.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                      <Quote className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{proposal.anchor.exact}</span>
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{t('inheritsAnchor')}</p>
                  )}

                  {approval.message ? (
                    <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                      {approval.message}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* Hard rule 5, said out loud: nothing exists until the human approves it. */}
      <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
        {model ? t('draftNoticeWithModel', { model }) : t('draftNotice')}
      </p>
    </div>
  );
}
