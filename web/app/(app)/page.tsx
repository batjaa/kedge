import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

// The authenticated home shell — the review queue's landing surface. Empty in
// M0 (importing a document arrives in M1); the point is that signing in visibly
// landed somewhere that is yours. Panel-based, DESIGN.md tokens.
export default async function HomeShellPage() {
  const session = await getSession();
  if (!session) redirect('/signin'); // defensive; the layout already guards

  const { user, workspace } = session;
  const firstName = user.name.split(/\s+/)[0] || user.name;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Review queue
        </h1>
        <span className="rounded-lg px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-zinc-500 ring-1 ring-inset ring-zinc-300 dark:text-zinc-400 dark:ring-zinc-700">
          {workspace.slug}
        </span>
      </div>
      <p className="mt-2 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
        Welcome, {firstName}. This is {workspace.name} — your personal workspace.
      </p>

      <div className="mt-8 rounded-2xl bg-white p-10 text-center ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
        <span
          aria-hidden="true"
          className="mx-auto flex h-10 w-10 items-end justify-end rounded-lg bg-emerald-400/90 p-2"
        >
          <span className="h-4 w-2.5 rounded-sm bg-zinc-900" />
        </span>
        <h2 className="mt-4 text-base font-semibold text-zinc-900 dark:text-white">
          No documents in review yet
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Importing an RFC or spec — paste a link and get a rendered page with
          anchored comment threads — arrives next. For now, browse the public
          docs to see the reading surface.
        </p>
        <Link
          href="/docs"
          className="mt-5 inline-flex items-center gap-1 rounded-full bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
        >
          Open the docs <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
