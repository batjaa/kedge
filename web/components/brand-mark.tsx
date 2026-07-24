import Link from 'next/link';
import { appName } from '@/lib/shared';

// The Kedge wordmark: the line-drawn kedge-anchor glyph (DESIGN.md brand) beside
// the lowercase Space Grotesk display wordmark. Links home. Open Harbor register:
// emerald-600 mark on light, emerald-400 on dark (DESIGN.md brand mark).
export function BrandMark({ href = '/' }: { href?: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 items-end justify-end rounded-md bg-emerald-600 p-1 dark:bg-emerald-400/90"
      >
        <span className="h-2.5 w-1.5 rounded-sm bg-white dark:bg-zinc-900" />
      </span>
      <span className="font-display font-semibold tracking-tight text-zinc-900 dark:text-white">
        {appName}
      </span>
    </Link>
  );
}
