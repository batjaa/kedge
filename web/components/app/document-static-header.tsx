import Link from 'next/link';
import { cn } from '@/lib/cn';

export function DocumentStaticHeader({
  title,
  eyebrow,
  sourceUrl,
  backHref,
  backLabel,
  bordered = false,
}: {
  title: string;
  eyebrow?: string | null;
  sourceUrl?: string | null;
  backHref?: string | null;
  backLabel?: string | null;
  bordered?: boolean;
}) {
  return (
    <header className={cn('mb-6', bordered ? 'border-b border-zinc-900/10 pb-6 dark:border-white/10' : null)}>
      {backHref && backLabel ? (
        <Link
          href={backHref}
          className="text-sm text-emerald-600 hover:text-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400"
        >
          {backLabel}
        </Link>
      ) : null}
      {eyebrow ? (
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
        {title}
      </h1>
      {sourceUrl ? (
        <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-500">
          {sourceUrl}
        </p>
      ) : null}
    </header>
  );
}
