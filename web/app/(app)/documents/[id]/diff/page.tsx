import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { ApprovalRoster } from '@/components/app/approval-roster';
import { DocumentDiffView } from '@/components/app/document-diff-view';
import { MetaChip } from '@/components/app/meta-chip';
import { PageContainer } from '@/components/app/page-container';
import { getDocumentVersionDiff } from '@/lib/documents';
import type { DocumentVersionDiff } from '@/lib/document-types';

export const dynamic = 'force-dynamic';

export default async function DocumentDiffPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ a?: string | string[]; b?: string | string[] }>;
}) {
  const { id } = await params;
  const { a, b } = await searchParams;
  const baseVersionId = parseRequiredVersionParam(a);
  const targetVersionId = parseRequiredVersionParam(b);
  const { status, diff } = await getDocumentVersionDiff(id, baseVersionId, targetVersionId);

  if (status === 403 || status === 404) notFound();

  if (!diff) {
    return (
      <PageContainer>
        <StatePanel
          title="Couldn't load this diff"
          body="The API is unreachable right now. Try again in a moment."
        />
      </PageContainer>
    );
  }

  if (status === 409 || !diff.comparable) {
    return (
      <PageContainer>
        <ProjectionGuard diff={diff} />
      </PageContainer>
    );
  }

  return <DocumentDiffView diff={diff} />;
}

function parseRequiredVersionParam(value: string | string[] | undefined): string {
  if (value === undefined) notFound();
  if (Array.isArray(value) || !/^[1-9][0-9]*$/.test(value)) notFound();

  return value;
}

function ProjectionGuard({ diff }: { diff: DocumentVersionDiff }) {
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/documents/${diff.document.id}?version=${diff.versions.b.id}`}
        className="mb-4 inline-flex text-sm text-emerald-600 hover:text-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400"
      >
        ← Back to document
      </Link>
      <div className="rounded-lg bg-white p-6 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
        <div className="flex flex-wrap items-center gap-2">
          <MetaChip>{diff.versions.a.label}</MetaChip>
          <ArrowRight className="h-4 w-4 text-zinc-400" aria-hidden="true" />
          <MetaChip>{diff.versions.b.label}</MetaChip>
          {diff.current_version ? <MetaChip>current {diff.current_version.label}</MetaChip> : null}
        </div>
        <div className="mt-5 flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">
              These versions can't be compared
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
              {diff.message ?? 'Their projection substrates differ, so comment offsets would not line up safely.'}
            </p>
          </div>
        </div>
        <ApprovalRoster approvals={diff.approvals} currentVersionLabel={diff.current_version?.label ?? null} />
      </div>
    </div>
  );
}

function StatePanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-8 rounded-lg bg-white p-8 text-center ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <h1 className="text-base font-semibold text-zinc-900 dark:text-white">
        {title}
      </h1>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {body}
      </p>
    </div>
  );
}
