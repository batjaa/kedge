import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { ImportForm } from '@/components/app/import-form';

// The authenticated home shell — the review queue's landing surface. M1 (#17)
// lands the paste-a-URL import entry point here: sign in, paste a link, get a
// rendered doc. Panel-based, DESIGN.md tokens.
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

      <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10 sm:p-8">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
          Import a document
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Paste a link to a spec or RFC and get a rendered page you can review.
        </p>
        <ImportForm />
      </div>
    </div>
  );
}
