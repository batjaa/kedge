import Link from 'next/link';
import { GitBranch } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { DocumentVersion } from '@/lib/document-types';
import { versionLabel } from '@/lib/version-label';

export function DocumentVersionSwitcher({
  documentId,
  versions,
  viewedVersionId,
  currentVersionId,
}: {
  documentId: number;
  versions: DocumentVersion[];
  viewedVersionId: number;
  currentVersionId: number;
}) {
  if (versions.length === 0) return null;

  return (
    <nav
      aria-label="Document versions"
      className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-zinc-100 p-1 text-sm ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:ring-white/10"
    >
      <GitBranch className="ml-2 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
      {versions.map((version) => {
        const selected = version.id === viewedVersionId;
        const latest = version.id === currentVersionId;
        const label = versionLabel(version) ?? `v${version.id}`;

        return (
          <Link
            key={version.id}
            href={`/documents/${documentId}?version=${version.id}`}
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
              selected
                ? 'bg-white text-zinc-900 ring-1 ring-inset ring-zinc-900/10 dark:bg-zinc-900 dark:text-white dark:ring-white/10'
                : 'text-zinc-500 hover:bg-white/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100',
            )}
          >
            <span>{label}</span>
            {latest ? <span className="text-[10px] text-emerald-600 dark:text-emerald-400">(latest)</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
