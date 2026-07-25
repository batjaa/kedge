import Link from 'next/link';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Document, DocumentVersion } from '@/lib/document-types';
import { versionLabel } from '@/lib/version-label';

export interface NewerVersionNotice {
  id: number;
  label: string;
  href: string;
}

export function newerVersionNoticeFromDocument({
  document,
  documentId,
  viewedVersionId,
}: {
  document: Document | null;
  documentId: number;
  viewedVersionId: number;
}): NewerVersionNotice | null {
  return newerVersionNoticeFromVersion({
    currentVersion: document?.current_version ?? null,
    documentId,
    viewedVersionId,
  });
}

export function newerVersionNoticeFromVersion({
  currentVersion,
  documentId,
  viewedVersionId,
}: {
  currentVersion: DocumentVersion | null;
  documentId: number;
  viewedVersionId: number;
}): NewerVersionNotice | null {
  if (!currentVersion || currentVersion.id === viewedVersionId) return null;

  return {
    id: currentVersion.id,
    label: versionLabel(currentVersion) ?? `v${currentVersion.id}`,
    href: `/documents/${documentId}?version=${currentVersion.id}`,
  };
}

export function DocumentNewVersionBanner({
  notice,
}: {
  notice: NewerVersionNotice | null;
}) {
  const t = useTranslations('review');

  if (!notice) return null;

  return (
    <div className="px-6">
      <div className="mx-auto mt-3 max-w-7xl rounded-2xl bg-emerald-50/50 px-4 py-3 text-sm text-emerald-950 ring-1 ring-emerald-500/20 dark:bg-emerald-500/5 dark:text-emerald-100 dark:ring-emerald-400/20">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Info className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            {t.rich('newVersion.notice', {
              label: notice.label,
              b: (chunks) => (
                <span className="font-mono text-[11px] font-semibold uppercase">{chunks}</span>
              ),
            })}
          </p>
          <Link
            href={notice.href}
            className="inline-flex rounded-full bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
          >
            {t('newVersion.viewLatest')}
          </Link>
        </div>
      </div>
    </div>
  );
}
