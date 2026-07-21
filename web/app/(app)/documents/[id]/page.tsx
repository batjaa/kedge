import { notFound } from 'next/navigation';
import { getDocument, getDocumentVersion, getDocumentVersions } from '@/lib/documents';
import { getProjects } from '@/lib/projects';
import { DocumentBody } from '@/components/app/document-body';
import { DocumentPoller } from '@/components/app/document-poller';
import { DocumentClaim } from '@/components/app/document-claim';
import { ImportFailed } from '@/components/app/import-failed';
import { DocumentShares } from '@/components/app/document-shares';
import { ImportWarnings } from '@/components/app/import-warnings';
import { DocumentReviewSurface } from '@/components/app/document-review-surface';
import { DocumentStaticHeader } from '@/components/app/document-static-header';
import { PageContainer } from '@/components/app/page-container';
import { StatePanel } from '@/components/app/state-panel';
import { getSession } from '@/lib/session';
import type { DocumentVersion, Project } from '@/lib/document-types';
import { versionLabel } from '@/lib/version-label';

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
  searchParams: Promise<{ claim?: string | string[]; version?: string | string[] }>;
}) {
  const { id } = await params;
  const { claim, version } = await searchParams;

  // Claim intent (#25): a just-signed-up visitor arriving from the demo page's
  // "Claim this doc" CTA. The doc still lives in the system workspace, so we must
  // NOT read it as this (non-member) user yet — hand off to the client claim,
  // which POSTs the claim and then lands on the clean, now-owned doc URL.
  if (claim === '1') {
    return (
      <PageContainer>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Claiming your document
        </h1>
        <DocumentClaim id={Number(id)} />
      </PageContainer>
    );
  }

  const { status, document } = await getDocument(id);
  const session = await getSession();

  // 403 (another workspace) and 404 both land on the 404 page — an id in a URL
  // never reveals whether a document exists elsewhere (SPEC 13).
  if (status === 403 || status === 404) notFound();

  if (!document) {
    return (
      <PageContainer>
        <StatePanel
          title="Couldn't load this document"
          body="The API is unreachable right now. Try again in a moment."
        />
      </PageContainer>
    );
  }

  const showStaticHeader = document.status !== 'ready';
  const requestedVersionId = parseVersionParam(version);
  let viewedVersion: DocumentVersion | null = document.current_version ?? null;
  let versions: DocumentVersion[] = viewedVersion ? [viewedVersion] : [];
  let projects: Project[] = [];

  if (document.status === 'ready' && document.current_version) {
    const [versionsResult, projectsResult] = await Promise.all([
      getDocumentVersions(id),
      getProjects(),
    ]);
    if (versionsResult.status === 403 || versionsResult.status === 404) notFound();
    if (versionsResult.status === 200) versions = versionsResult.versions;
    // The assignment selector's options; a refused/unreachable read just leaves
    // the selector out (it degrades to no-projects, never an error).
    projects = projectsResult.projects;

    if (requestedVersionId !== null) {
      const versionResult = await getDocumentVersion(id, requestedVersionId);
      if (versionResult.status === 403 || versionResult.status === 404) notFound();

      if (!versionResult.version) {
        return (
          <PageContainer>
            <StatePanel
              title="Couldn't load this version"
              body="The API is unreachable right now. Try again in a moment."
            />
          </PageContainer>
        );
      }

      viewedVersion = versionResult.version;
    }
  }

  return (
    <div>
      {showStaticHeader ? (
        <PageContainer>
          <DocumentStaticHeader
            title={document.title}
            sourceUrl={document.source_url}
            backHref="/"
            backLabel="← Review queue"
          />

          {document.status === 'importing' ? (
            <DocumentPoller id={document.id} />
          ) : null}

          {document.status === 'failed' ? (
            <ImportFailed id={document.id} error={document.sync_error} />
          ) : null}
        </PageContainer>
      ) : null}

      {document.status === 'ready' && document.current_version && viewedVersion ? (
        <>
          {(viewedVersion.import_warnings ?? []).length > 0 ? (
            <PageContainer flush>
              <div className="pt-6">
                <ImportWarnings warnings={viewedVersion.import_warnings ?? []} />
              </div>
            </PageContainer>
          ) : null}
          <DocumentReviewSurface
            documentId={document.id}
            title={document.title}
            surfaceLabel="Authenticated document"
            sourceUrl={document.source_url}
            lifecycleStatus={document.lifecycle_status}
            versions={versions}
            viewedVersionId={viewedVersion.id}
            currentVersionId={document.current_version.id}
            versionLabel={versionLabel(viewedVersion)}
            syncedAt={viewedVersion.synced_at}
            approvals={document.approvals ?? []}
            currentUserId={session?.user.id ?? null}
            canUpdateLifecycle={document.capabilities?.update_lifecycle ?? false}
            projects={projects}
            projectId={document.project?.id ?? null}
            backHref="/"
            backLabel="← Review queue"
            plainText={viewedVersion.plain_text ?? null}
            projectionVersion={viewedVersion.projection_version ?? null}
            canResync
            lastSyncStatus={document.last_sync_status}
            syncError={document.sync_error}
          >
            <DocumentBody
              format={document.format}
              mdxOk={viewedVersion.mdx_ok}
              content={viewedVersion.content}
            />
          </DocumentReviewSurface>
        </>
      ) : null}

      {document.status === 'ready' ? (
        <PageContainer flush>
          <div className="pb-10 sm:pb-14">
            <DocumentShares documentId={document.id} />
          </div>
        </PageContainer>
      ) : null}
    </div>
  );
}

function parseVersionParam(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value) || !/^[1-9][0-9]*$/.test(value)) notFound();

  return value;
}
