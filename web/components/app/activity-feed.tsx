import type { ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { formatRelativeTime } from '@/lib/intl-time';
import type { ActivityContext, ActivityEvent, ActivityTarget } from '@/lib/activity-types';

// The dashboard's Recent activity panel (SPEC §16, M3.8 #111;
// docs/designs/app-dashboard.html). Fills the M3.7 reserved slot below the
// documents list: actor avatar + sentence + target link + relative time, loaded
// once on page load — NO polling/realtime (M5 owns liveness).
//
// Three states:
//   • events === null  → A1 degradation: a failed feed read renders NOTHING, so
//     the dashboard is never blocked and the existing degraded banner is the only
//     outage signal (the stats strip's exact contract).
//   • events === []    → an empty workspace's designed empty state.
//   • events[]         → the panel.
//
// Every sentence renders from the row's frozen snapshot (2A): a title, section,
// or actor name is plain text passed through normal React escaping, so an
// imported document's untrusted title can never inject markup. The target link is
// dropped (rendered as inert text) when the row carries no target — a dead
// subject loses its link, never its row.
//
// i18n (M3.9 #123): each sentence is ONE whole ICU message per event type
// (activity catalog) — an `{actor, select, …}` branch handles system rows so
// word order is each language's own, never English glued together; <person> and
// <target> tags carry the styled name and the link. Counts are ICU plurals
// (CLDR covers Mongolian) and relative times ride Intl on the active locale.
// Names, titles, and API `reason` prose are data, untranslated.
export function ActivityFeed({ events }: { events: ActivityEvent[] | null }) {
  const t = useTranslations('activity');

  if (events === null) return null;

  return (
    <section data-slot="activity-feed" className="mt-10" aria-label={t('heading')}>
      <h2 className="px-1 text-sm font-semibold text-zinc-900 dark:text-white">{t('heading')}</h2>

      {events.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="mt-3 divide-y divide-zinc-900/5 rounded-2xl bg-white text-sm shadow-sm ring-1 ring-zinc-900/10 dark:divide-white/5 dark:bg-white/[.03] dark:ring-white/10">
          {events.map((event) => (
            <ActivityRow key={event.id} event={event} />
          ))}
        </ul>
      )}
    </section>
  );
}

function EmptyState() {
  const t = useTranslations('activity');

  return (
    <div className="mt-3 rounded-2xl bg-white px-4 py-8 text-center ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('emptyTitle')}</p>
      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-500">
        {t('emptyBody')}
      </p>
    </div>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const locale = useLocale();

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Leading event={event} />
      <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-400">
        <Sentence event={event} />
      </p>
      <time
        dateTime={event.created_at}
        className="ml-auto shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-600"
      >
        {formatRelativeTime(event.created_at, locale)}
      </time>
    </li>
  );
}

// The leading glyph: a person's action shows their initials; the aggregate /
// system rows (re-sync, gone-stale, failed import) show a themed marker, matching
// the mockup's alert rows.
function Leading({ event }: { event: ActivityEvent }) {
  const base = 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium';

  switch (event.type) {
    case 'reanchor.completed':
      return <span className={`${base} bg-zinc-100 text-zinc-500 dark:bg-white/10 dark:text-zinc-400`} aria-hidden>↻</span>;
    case 'approval.gone_stale':
      return <span className={`${base} bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/30 dark:text-amber-400`} aria-hidden>!</span>;
    case 'document.import_failed':
      return <span className={`${base} bg-rose-500/10 text-rose-600 ring-1 ring-inset ring-rose-500/30 dark:text-rose-400`} aria-hidden>!</span>;
    default: {
      const name = event.actor.name;
      if (!name) {
        return <span className={`${base} bg-zinc-100 text-zinc-500 dark:bg-white/10 dark:text-zinc-400`} aria-hidden>•</span>;
      }
      return (
        <span className={`${base} ${avatarTone(name)} text-white`} aria-hidden>
          {initials(name)}
        </span>
      );
    }
  }
}

// The sentence per event type — one whole localized ICU message, so word order
// belongs to the language. Every interpolation is plain text (React-escaped),
// every target a dropped-when-dead link.
function Sentence({ event }: { event: ActivityEvent }) {
  const t = useTranslations('activity');
  const { type, actor, context, target } = event;

  // The rich-tag values every sentence shares: the actor select + styled name,
  // and the <target> tag rendering the snapshot label as a link (or inert text).
  const values = (label: string) => ({
    actor: actor.name ? 'named' : 'system',
    name: actor.name ?? '',
    person: (chunks: ReactNode) => (
      <span className="font-medium text-zinc-800 dark:text-zinc-200">{chunks}</span>
    ),
    target: () => <TargetLink target={target}>{label}</TargetLink>,
  });

  const docLabel = documentLabel(context, t('documentFallback'));

  switch (type) {
    case 'comment.created':
      return <>{t.rich('sentence.commentCreated', values(docLabel))}</>;
    case 'suggestion.accepted':
      return <>{t.rich('sentence.suggestionAccepted', values(docLabel))}</>;
    case 'suggestion.declined':
      return <>{t.rich('sentence.suggestionDeclined', values(docLabel))}</>;
    case 'approval.given':
      return <>{t.rich('sentence.approvalGiven', values(docLabel))}</>;
    case 'document.imported':
      return <>{t.rich('sentence.documentImported', values(docLabel))}</>;
    case 'workspace.renamed':
      return (
        <>
          {t.rich(
            'sentence.workspaceRenamed',
            values(context.workspace_name ?? t('workspaceFallback')),
          )}
        </>
      );
    case 'approval.gone_stale':
      return (
        <>
          {t.rich('sentence.approvalsGoneStale', {
            ...values(docLabel),
            count: context.count ?? 1,
          })}
        </>
      );
    case 'document.import_failed':
      return (
        <>
          {t.rich('sentence.importFailed', {
            ...values(docLabel),
            hasReason: context.reason ? 'yes' : 'no',
            reason: context.reason ?? '',
          })}
        </>
      );
    case 'reanchor.completed':
      return (
        <>
          {t.rich('sentence.reanchorCompleted', {
            ...values(docLabel),
            anchored: context.anchored ?? 0,
            relocated: context.relocated ?? 0,
            orphaned: context.orphaned ?? 0,
          })}
        </>
      );
  }
}

// The document label a row links: title, plus the anchored section when the
// snapshot froze one (comment/suggestion rows). Both plain text — inert on
// render. The fallback is the caller's localized "a document".
function documentLabel(context: ActivityContext, fallback: string): string {
  const title = context.document_title ?? fallback;
  return context.section ? `${title} § ${context.section}` : title;
}

function TargetLink({ target, children }: { target: ActivityTarget | null; children: ReactNode }) {
  // A dead/absent target renders the label as inert text — the link drops, the
  // sentence stays (2A). Never fabricate an href from the snapshot.
  if (target === null) {
    return <span className="font-mono text-zinc-500 dark:text-zinc-400">{children}</span>;
  }

  const href = target.type === 'document' ? `/documents/${target.id}` : '/settings';
  return (
    <Link href={href} className="font-mono text-emerald-700 hover:underline dark:text-emerald-400">
      {children}
    </Link>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// A deterministic (SSR-stable) tone per name, so avatars read as distinct people
// without storing a color. Palette stays inside the Open Harbor register.
const AVATAR_TONES = [
  'bg-sky-600',
  'bg-emerald-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-rose-600',
];

function avatarTone(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash + name.charCodeAt(i)) % AVATAR_TONES.length;
  }
  return AVATAR_TONES[hash];
}
