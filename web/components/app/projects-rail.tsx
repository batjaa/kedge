import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { unfiledDocumentCount } from '@/lib/projects-rail';
import type { Project, WorkspaceSummary } from '@/lib/document-types';

// The dashboard's projects rail (SPEC §16, M3.7; docs/designs/app-dashboard.html)
// — projects navigation beside the documents table on desktop. Each card links to
// its project page and carries the three per-project counts the projects index
// returns (docs / open threads / orphans — each a shared-scope count, 7A). Below
// the cards: the Unfiled bucket (its doc count DERIVED from the summary, never a
// fourth query) and the ghosted M5 queue card, so the roadmap is honest in-product.
//
// Rendered only at `lg` and up (the caller hides it); narrow viewports keep the
// single-column grouped list, whose project group headers already link to the
// same pages. Display-only: it reads seeded state and holds no live counters —
// the live workspace truth is the stats strip above it (6A). Counts are ICU
// plurals on the active locale (M3.9); project names are user data, untouched.
export function ProjectsRail({
  projects,
  summary,
  degraded = false,
  className,
}: {
  projects: Project[];
  /** Powers the Unfiled bucket's derived count; null (A1) drops that count. */
  summary: WorkspaceSummary | null;
  /**
   * The projects read failed, so this (empty) list is not authoritative — the
   * Unfiled derivation would read every document as Unfiled. Drop the count
   * rather than assert a wrong one; the card still stands.
   */
  degraded?: boolean;
  className?: string;
}) {
  const t = useTranslations('dashboard');
  const unfiled = degraded ? null : unfiledDocumentCount(summary, projects);

  return (
    <aside aria-label={t('rail.heading')} className={cn('space-y-3', className)}>
      <h2 className="px-1 text-sm font-semibold text-zinc-900 dark:text-white">
        {t('rail.heading')}
      </h2>

      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}

      <UnfiledCard count={unfiled} />
      <QueueGhost />
    </aside>
  );
}

// One project card: name + the three counts, linking to the project page. Open
// and orphan counts show only when non-zero (a clean project reads as "N docs"),
// with the orphan count in the rose alert hue the strip and rows use. Counts are
// optional on the type — a just-created project (added client-side) has only its
// doc count — so each falls back to 0.
function ProjectCard({ project }: { project: Project }) {
  const t = useTranslations('dashboard');
  const docs = project.documents_count ?? 0;
  const open = project.open_threads_count ?? 0;
  const orphans = project.orphaned_threads_count ?? 0;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-inset ring-zinc-900/10 hover:ring-zinc-900/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/[.03] dark:ring-white/10 dark:hover:ring-white/20"
    >
      <span className="text-sm font-semibold text-zinc-900 dark:text-white">{project.name}</span>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
        <span>{t('rail.docs', { count: docs })}</span>
        {open > 0 ? <span>{t('rail.open', { count: open })}</span> : null}
        {orphans > 0 ? (
          <span className="text-rose-600 dark:text-rose-400">
            {t('rail.orphans', { count: orphans })}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

// The Unfiled bucket (14A): the absence of a project, never a row and never a
// link. Dashed to read as a container, not a project. Its count is derived from
// the summary; a null summary (A1) keeps the card and drops the count.
function UnfiledCard({ count }: { count: number | null }) {
  const t = useTranslations('dashboard');

  return (
    <div className="rounded-2xl border border-dashed border-zinc-900/15 p-4 dark:border-white/15">
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">{t('rail.unfiled')}</span>
        {count !== null ? (
          <span className="ml-auto font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
            {t('rail.docs', { count })}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
        {t('rail.unfiledHint')}
      </p>
    </div>
  );
}

// The ghosted M5 card: the review queue arrives with M5, so the rail states that
// in-product rather than offering a dead link. Non-interactive, dimmed, badged.
function QueueGhost() {
  const t = useTranslations('dashboard');

  return (
    <div className="rounded-2xl border border-dashed border-zinc-900/10 p-4 opacity-70 dark:border-white/10">
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400 dark:text-zinc-500">{t('rail.queueTitle')}</span>
        <span className="ml-auto rounded-lg bg-zinc-400/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-zinc-400 ring-1 ring-inset ring-zinc-400/30 dark:text-zinc-500">
          M5
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-zinc-400 dark:text-zinc-500">
        {t('rail.queueBody')}
      </p>
    </div>
  );
}
