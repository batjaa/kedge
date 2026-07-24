import type { ReactNode } from 'react';
import Link from 'next/link';
import { relativeTime } from '@/lib/relative-time';
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
export function ActivityFeed({ events }: { events: ActivityEvent[] | null }) {
  if (events === null) return null;

  return (
    <section data-slot="activity-feed" className="mt-10" aria-label="Recent activity">
      <h2 className="px-1 text-sm font-semibold text-zinc-900 dark:text-white">Recent activity</h2>

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
  return (
    <div className="mt-3 rounded-2xl bg-white px-4 py-8 text-center ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No activity yet</p>
      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-500">
        Replies, accepted suggestions, re-syncs, and settling imports will show up here as you review.
      </p>
    </div>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
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
        {relativeTime(event.created_at)}
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

// The sentence per event type — every string is plain text (React-escaped), every
// target a dropped-when-dead link. The re-sync digest is one line (1A).
function Sentence({ event }: { event: ActivityEvent }) {
  const { type, actor, context, target } = event;
  const title = <TargetLink target={target}>{documentLabel(context)}</TargetLink>;

  switch (type) {
    case 'comment.created':
      return <>{actorLead(actor.name, 'commented')} on {title}</>;
    case 'suggestion.accepted':
      return <>{actorLead(actor.name, 'accepted a suggestion')} on {title}</>;
    case 'suggestion.declined':
      return <>{actorLead(actor.name, 'declined a suggestion')} on {title}</>;
    case 'approval.given':
      return <>{actorLead(actor.name, 'approved')} {title}</>;
    case 'document.imported':
      return <>{actorLead(actor.name, 'imported')} {title}</>;
    case 'workspace.renamed':
      return (
        <>
          {actorLead(actor.name, 'renamed the workspace to')}{' '}
          <TargetLink target={target}>{context.workspace_name ?? 'your workspace'}</TargetLink>
        </>
      );
    case 'approval.gone_stale': {
      const count = context.count ?? 1;
      return (
        <>
          {count} {count === 1 ? 'approval' : 'approvals'} on {title} went stale after a re-sync
        </>
      );
    }
    case 'document.import_failed':
      return (
        <>
          Import of {title} failed{context.reason ? <> — {context.reason}</> : null}
        </>
      );
    case 'reanchor.completed':
      return (
        <>
          Re-synced {title} — {context.anchored ?? 0} anchored, {context.relocated ?? 0} relocated,{' '}
          {context.orphaned ?? 0} orphaned
        </>
      );
  }
}

// The document label a row links: title, plus the anchored section when the
// snapshot froze one (comment/suggestion rows). Both plain text — inert on render.
function documentLabel(context: ActivityContext): string {
  const title = context.document_title ?? 'a document';
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

// "Sarah commented" when an actor is known; "Commented" (capitalized verb) for a
// system-authored row with no snapshot name.
function actorLead(name: string | null, verb: string): ReactNode {
  if (!name) {
    return capitalize(verb);
  }
  return (
    <>
      <span className="font-medium text-zinc-800 dark:text-zinc-200">{name}</span> {verb}
    </>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
