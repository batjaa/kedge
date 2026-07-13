import Link from 'next/link';
import { appName } from '@/lib/shared';

// The Kedge wordmark: the line-drawn kedge-anchor glyph (DESIGN.md brand) beside
// the lowercase system-sans wordmark. Links home. Matches the header treatment
// in docs/designs/review-page.html.
export function BrandMark({ href = '/' }: { href?: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 items-end justify-end rounded-md bg-emerald-400/90 p-1"
      >
        <span className="h-2.5 w-1.5 rounded-sm bg-zinc-900" />
      </span>
      <span className="font-semibold tracking-tight text-zinc-900 dark:text-white">
        {appName}
      </span>
    </Link>
  );
}
