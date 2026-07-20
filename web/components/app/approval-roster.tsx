import { CheckCircle2 } from 'lucide-react';
import type { Approval } from '@/lib/document-types';
import { cn } from '@/lib/cn';

export function ApprovalRoster({
  approvals,
  currentVersionLabel,
}: {
  approvals: Approval[];
  currentVersionLabel?: string | null;
}) {
  if (approvals.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap items-center gap-1.5">
      {approvals.map((approval) => (
        <ApprovalRosterItem
          key={approval.id}
          approval={approval}
          currentVersionLabel={currentVersionLabel}
        />
      ))}
    </ul>
  );
}

function ApprovalRosterItem({
  approval,
  currentVersionLabel,
}: {
  approval: Approval;
  currentVersionLabel?: string | null;
}) {
  const label = approval.stale && currentVersionLabel
    ? `approved ${approval.version_label} · current ${currentVersionLabel}`
    : `approved ${approval.version_label}`;

  return (
    <li
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-2 py-1 text-xs ring-1 ring-inset',
        approval.stale
          ? 'bg-amber-400/10 text-amber-700 ring-amber-500/25 dark:text-amber-300 dark:ring-amber-400/25'
          : 'bg-emerald-400/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300 dark:ring-emerald-400/25',
      )}
      title={label}
    >
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate font-medium text-zinc-800 dark:text-zinc-100">
        {approval.user.name ?? 'Reviewer'}
      </span>
      <span className="shrink-0 font-mono text-[10px]">{label}</span>
    </li>
  );
}
