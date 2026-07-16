import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getSharedDocument } from '@/lib/shared-document';
import { DocumentBody } from '@/components/app/document-body';
import { DocumentReviewSurface } from '@/components/app/document-review-surface';
import { DocumentStaticHeader } from '@/components/app/document-static-header';
import { SharedLinkGone } from '@/components/shared/shared-link-gone';
import { ClaimCta } from '@/components/shared/claim-cta';
import { SharedDocumentPoller } from '@/components/shared/shared-document-poller';
import { ReviewerVerification } from '@/components/shared/reviewer-verification';
import {
  REVIEWER_VERIFICATION_STATUS,
  type VerifyReturnState,
} from '@/lib/reviewer-verification-status';

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
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ verified?: string; verify?: string; verify_complete?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const result = await getSharedDocument(token, await headers());

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
  const verifiedReviewer = doc.reviewer.verified === true && typeof doc.document_id === 'number';
  const verifyState = verifyReturnState(query.verify);
  const showShareHeader = !verifiedReviewer || doc.status !== 'ready';

  return (
    <div>
      {showShareHeader ? (
        <DocumentStaticHeader
          title={doc.title}
          eyebrow={isDemo ? 'Demo document' : verifiedReviewer ? 'Shared document · verified reviewer' : 'Shared document · read-only'}
          bordered
        />
      ) : null}

      {doc.status === 'ready' && doc.current_version ? (
        verifiedReviewer ? (
          <>
            {query.verified === '1' ? (
              <ReviewStatePanel message="Email verified. You can comment on this document now." />
            ) : null}
            <DocumentReviewSurface
              documentId={doc.document_id!}
              title={doc.title}
              surfaceLabel="Shared document · verified reviewer"
              versionLabel={`v${doc.current_version.id}`}
              syncedAt={doc.current_version.synced_at}
              plainText={doc.current_version.plain_text ?? null}
              projectionVersion={doc.current_version.projection_version ?? null}
            >
              <DocumentBody
                format={doc.format}
                mdxOk={doc.current_version.mdx_ok}
                content={doc.current_version.content}
              />
            </DocumentReviewSurface>
          </>
        ) : (
          <>
            <DocumentBody
              format={doc.format}
              mdxOk={doc.current_version.mdx_ok}
              content={doc.current_version.content}
            />
            {!isDemo ? (
              <ReviewerVerification
                token={token}
                returnState={verifyState}
                completionToken={query.verify_complete ?? null}
              />
            ) : null}
          </>
        )
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

function verifyReturnState(value: string | undefined): VerifyReturnState | null {
  return value === REVIEWER_VERIFICATION_STATUS.expired
    || value === REVIEWER_VERIFICATION_STATUS.used
    || value === REVIEWER_VERIFICATION_STATUS.invalid
    || value === REVIEWER_VERIFICATION_STATUS.accountRequired
    ? value
    : null;
}

function ReviewStatePanel({ message }: { message: string }) {
  return (
    <div className="mb-5 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-600/15 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-400/20">
      {message}
    </div>
  );
}
