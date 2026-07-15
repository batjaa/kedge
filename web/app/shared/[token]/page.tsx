import type { Metadata } from 'next';
import { getSharedDocument } from '@/lib/shared-document';
import { DocumentBody } from '@/components/app/document-body';
import { SharedLinkGone } from '@/components/shared/shared-link-gone';
import { ClaimCta } from '@/components/shared/claim-cta';
import { SharedDocumentPoller } from '@/components/shared/shared-document-poller';

// The public, read-only share surface (SPEC 10.2, ticket #24). Anonymous — no
// auth, no session — rendering the doc through the SAME DocumentBody as the
// authenticated page, so an imported .mdx doc is hardened identically here (SPEC
// §6.1). A revoked / expired / unknown token lands on the friendly gone page,
// never a raw error. `noindex` is enforced by the /shared layout (meta robots) +
// next.config (X-Robots-Tag header).
//
// Never cached: a revoked or expired link must go dark on the very next open.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shared document · Kedge',
};

export default async function SharedDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await getSharedDocument(token);

  if (result.kind === 'gone') {
    return <SharedLinkGone reason={result.reason} />;
  }

  if (result.kind === 'error') {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl bg-white p-8 text-center ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">
          Couldn&apos;t load this document
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Something went wrong reaching the server. Try again in a moment.
        </p>
      </div>
    );
  }

  const doc = result.document;
  // A demo doc (SPEC §10.3, #25) advertises itself as claimable and carries its
  // id; that's the whole difference from an ordinary share on this surface.
  const isDemo = doc.claimable === true && typeof doc.document_id === 'number';

  return (
    <div>
      <header className="mb-8 border-b border-zinc-900/10 pb-6 dark:border-white/10">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          {isDemo ? 'Demo document' : 'Shared document · read-only'}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
          {doc.title}
        </h1>
      </header>

      {doc.status === 'ready' && doc.current_version ? (
        <DocumentBody
          format={doc.format}
          mdxOk={doc.current_version.mdx_ok}
          content={doc.current_version.content}
        />
      ) : doc.status === 'importing' && isDemo ? (
        // A freshly-pasted demo doc: poll the public surface and reveal the
        // render the moment it lands, without asking the visitor to refresh.
        <SharedDocumentPoller token={token} />
      ) : (
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          This document is still being prepared. Refresh in a moment.
        </p>
      )}

      {isDemo ? <ClaimCta documentId={doc.document_id!} /> : null}
    </div>
  );
}
