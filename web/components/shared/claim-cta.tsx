import Link from 'next/link';
import { useTranslations } from 'next-intl';

// The "Claim this doc" call to action on a rendered demo page (SPEC §10.3, #25).
// Signing up claims the doc into the new account before its 48h expiry, so the
// stranger who just saw the render keeps it. The link carries a `next` intent —
// the document's claim route — so registration lands straight on the now-owned
// doc, with the claim completing on the way (see the document page's ?claim=1
// handling). DESIGN.md tokens; copy from the `claim` catalog (M3.9 #124).
export function ClaimCta({ documentId }: { documentId: number }) {
  const t = useTranslations('claim');
  const claimNext = `/documents/${documentId}?claim=1`;
  const href = `/signup?next=${encodeURIComponent(claimNext)}`;

  return (
    <aside className="mt-12 rounded-2xl bg-emerald-50 p-6 ring-1 ring-emerald-600/15 dark:bg-emerald-400/[.06] dark:ring-emerald-400/20 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">
            {t('cta.heading')}
          </h2>
          <p className="mt-1 max-w-md text-sm leading-6 text-emerald-800/80 dark:text-emerald-200/70">
            {t('cta.body')}
          </p>
        </div>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900"
        >
          {t('cta.button')}
        </Link>
      </div>
    </aside>
  );
}
