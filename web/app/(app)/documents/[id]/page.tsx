import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDocument } from '@/lib/documents';
import { renderMarkdown } from '@/lib/render-markdown';
import { DocumentPoller } from '@/components/app/document-poller';
import { ImportFailed } from '@/components/app/import-failed';
import { DocumentShares } from '@/components/app/document-shares';
import { ImportWarnings } from '@/components/app/import-warnings';

// The imported-document reading surface (ticket #17). A server component fed
// from the API via the BFF cookie-forwarding read. Renders the three import
// states — importing (poll), failed (retry CTA), ready (rendered markdown) —
// inside the authenticated shell. Markdown-level rendering only; the hardened
// MDX pipeline (#20) and diagrams (#21) widen this later. Never cached: an
// import in flight must re-read on every navigation.
export const dynamic = 'force-dynamic';

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { status, document } = await getDocument(id);

  // 403 (another workspace) and 404 both land on the 404 page — an id in a URL
  // never reveals whether a document exists elsewhere (SPEC 13).
  if (status === 403 || status === 404) notFound();

  if (!document) {
    return (
      <StatePanel
        title="Couldn't load this document"
        body="The API is unreachable right now. Try again in a moment."
      />
    );
  }

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/"
          className="text-sm text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
        >
          ← Review queue
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
          {document.title}
        </h1>
        {document.source_url ? (
          <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-500">
            {document.source_url}
          </p>
        ) : null}
      </div>

      {document.status === 'importing' ? (
        <DocumentPoller id={document.id} />
      ) : null}

      {document.status === 'failed' ? (
        <ImportFailed id={document.id} error={document.sync_error} />
      ) : null}

      {document.status === 'ready' && document.current_version ? (
        <>
          <ImportWarnings
            warnings={document.current_version.import_warnings ?? []}
          />
          <article className="prose max-w-none">
            {await renderMarkdown(document.current_version.content)}
          </article>
        </>
      ) : null}

      {document.status === 'ready' ? <DocumentShares documentId={document.id} /> : null}
    </div>
  );
}

function StatePanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-8 rounded-2xl bg-white p-8 text-center ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
        {title}
      </h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {body}
      </p>
    </div>
  );
}
