import { notFound } from 'next/navigation';
import { getDocument } from '@/lib/documents';
import { DocumentBody } from '@/components/app/document-body';
import { DocumentPoller } from '@/components/app/document-poller';
import { DocumentClaim } from '@/components/app/document-claim';
import { ImportFailed } from '@/components/app/import-failed';
import { DocumentShares } from '@/components/app/document-shares';
import { ImportWarnings } from '@/components/app/import-warnings';
import { DocumentReviewSurface } from '@/components/app/document-review-surface';
import { DocumentStaticHeader } from '@/components/app/document-static-header';
import { getSession } from '@/lib/session';

// The imported-document reading surface (ticket #17). A server component fed
// from the API via the BFF cookie-forwarding read. Renders the three import
// states — importing (poll), failed (retry CTA), ready (rendered body) — inside
// the authenticated shell. The body goes through the shared DocumentBody, which
// picks markdown vs. the hardened MDX pipeline by format + mdx_ok (#20). Never
// cached: an import in flight must re-read on every navigation.
export const dynamic = 'force-dynamic';

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ claim?: string }>;
}) {
  const { id } = await params;
  const { claim } = await searchParams;

  // Claim intent (#25): a just-signed-up visitor arriving from the demo page's
  // "Claim this doc" CTA. The doc still lives in the system workspace, so we must
  // NOT read it as this (non-member) user yet — hand off to the client claim,
  // which POSTs the claim and then lands on the clean, now-owned doc URL.
  if (claim === '1') {
    return (
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Claiming your document
        </h1>
        <DocumentClaim id={Number(id)} />
      </div>
    );
  }

  const { status, document } = await getDocument(id);
  const session = await getSession();

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

  const showStaticHeader = document.status !== 'ready';

  return (
    <div>
      {showStaticHeader ? (
        <DocumentStaticHeader
          title={document.title}
          sourceUrl={document.source_url}
          backHref="/"
          backLabel="← Review queue"
        />
      ) : null}

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
          <DocumentReviewSurface
            documentId={document.id}
            title={document.title}
            surfaceLabel="Authenticated document"
            sourceUrl={document.source_url}
            lifecycleStatus={document.lifecycle_status}
            versionLabel={`v${document.current_version.id}`}
            syncedAt={document.current_version.synced_at}
            approvals={document.approvals ?? []}
            currentUserId={session?.user.id ?? null}
            canUpdateLifecycle={document.capabilities?.update_lifecycle ?? false}
            backHref="/"
            backLabel="← Review queue"
            plainText={document.current_version.plain_text ?? null}
            projectionVersion={document.current_version.projection_version ?? null}
            canResync
            lastSyncStatus={document.last_sync_status}
            syncError={document.sync_error}
          >
            <DocumentBody
              format={document.format}
              mdxOk={document.current_version.mdx_ok}
              content={document.current_version.content}
            />
          </DocumentReviewSurface>
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
