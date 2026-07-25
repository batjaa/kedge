import { useTranslations } from 'next-intl';
import type { ShareGoneReason } from '@/lib/share-types';

// The friendly named page a dead share link lands on (SPEC 10.2) — never a bare
// 403/404. Revoked, expired, and unknown tokens all arrive here; the heading is
// constant ("This link is no longer active") and only the sub-copy differs, so a
// mistyped or revoked link is never scary and never leaks whether it existed.
// Copy comes from the `shared` catalog (M3.9 #124), keyed by reason.

export function SharedLinkGone({ reason }: { reason: ShareGoneReason }) {
  const t = useTranslations('shared');
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl bg-white p-8 text-center ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <span
        aria-hidden="true"
        className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-900/5 text-zinc-500 dark:bg-white/5 dark:text-zinc-400"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6">
          <path
            fillRule="evenodd"
            d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
            clipRule="evenodd"
          />
        </svg>
      </span>
      <h1 className="mt-5 text-lg font-semibold text-zinc-900 dark:text-white">
        {t('gone.heading')}
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {t(`gone.${reason}`)}
      </p>
    </div>
  );
}
