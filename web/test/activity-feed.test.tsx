import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActivityFeed } from '@/components/app/activity-feed';
import type { ActivityEvent, ActivityEventType, ActivityTarget } from '@/lib/activity-types';

// The Recent-activity panel's spec lines (SPEC §16, M3.8 #111): a sentence per
// event type from the frozen snapshot (2A), the re-sync digest as ONE line (1A),
// untrusted titles rendered inert, the dead-target link drop (2A), A1 degradation,
// the empty state, and relative-time formatting. Static markup, no browser — the
// panel has no client behaviour to drive (no polling; M5 owns liveness).

function event(overrides: Partial<ActivityEvent> & { type: ActivityEventType }): ActivityEvent {
  return {
    id: 1,
    actor: { name: 'Sarah Chen' },
    context: {},
    target: { type: 'document', id: 42 } satisfies ActivityTarget,
    created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    ...overrides,
  };
}

describe('ActivityFeed degradation (A1)', () => {
  it('renders nothing when the feed read failed', () => {
    // A null feed is an outage: the panel is absent so the dashboard is never
    // blocked and the existing degraded banner is the only signal.
    expect(renderToStaticMarkup(<ActivityFeed events={null} />)).toBe('');
  });

  it('renders the designed empty state for a workspace with no activity', () => {
    const html = renderToStaticMarkup(<ActivityFeed events={[]} />);
    expect(html).toContain('No activity yet');
    // Distinct from an outage — the panel IS present.
    expect(html).toContain('Recent activity');
  });
});

describe('ActivityFeed sentences', () => {
  it('renders a comment as a reply on the anchored section, linking to the document', () => {
    const html = renderToStaticMarkup(
      <ActivityFeed
        events={[
          event({
            type: 'comment.created',
            actor: { name: 'Sarah Chen' },
            context: { document_title: 'SPEC.md', section: '9.2' },
          }),
        ]}
      />,
    );
    expect(html).toContain('Sarah Chen');
    expect(html).toContain('commented on');
    expect(html).toContain('SPEC.md § 9.2');
    expect(html).toContain('href="/documents/42"');
  });

  it('renders an accepted suggestion', () => {
    const html = renderToStaticMarkup(
      <ActivityFeed
        events={[event({ type: 'suggestion.accepted', context: { document_title: 'rfc-017.mdx' } })]}
      />,
    );
    expect(html).toContain('accepted a suggestion on');
    expect(html).toContain('rfc-017.mdx');
  });

  it('renders a declined suggestion', () => {
    const html = renderToStaticMarkup(
      <ActivityFeed
        events={[event({ type: 'suggestion.declined', context: { document_title: 'rfc-017.mdx' } })]}
      />,
    );
    expect(html).toContain('declined a suggestion on');
  });

  it('renders an approval granted', () => {
    const html = renderToStaticMarkup(
      <ActivityFeed events={[event({ type: 'approval.given', context: { document_title: 'SPEC.md' } })]} />,
    );
    expect(html).toContain('approved');
    expect(html).toContain('SPEC.md');
  });

  it('renders a settled import', () => {
    const html = renderToStaticMarkup(
      <ActivityFeed
        events={[event({ type: 'document.imported', context: { document_title: 'New RFC' } })]}
      />,
    );
    expect(html).toContain('imported');
    expect(html).toContain('New RFC');
  });

  it('renders a failed import with its user-facing reason', () => {
    const html = renderToStaticMarkup(
      <ActivityFeed
        events={[
          event({
            type: 'document.import_failed',
            actor: { name: null },
            context: { document_title: 'Broken', reason: 'source unreachable' },
          }),
        ]}
      />,
    );
    expect(html).toContain('Import of');
    expect(html).toContain('failed');
    expect(html).toContain('source unreachable');
  });

  it('renders gone-stale approvals, pluralized', () => {
    const one = renderToStaticMarkup(
      <ActivityFeed
        events={[
          event({ type: 'approval.gone_stale', actor: { name: null }, context: { document_title: 'SPEC.md', count: 1 } }),
        ]}
      />,
    );
    expect(one).toContain('1 approval on');
    expect(one).toContain('went stale after a re-sync');

    const many = renderToStaticMarkup(
      <ActivityFeed
        events={[
          event({ type: 'approval.gone_stale', actor: { name: null }, context: { document_title: 'SPEC.md', count: 3 } }),
        ]}
      />,
    );
    expect(many).toContain('3 approvals on');
  });

  it('renders a workspace rename linking to settings', () => {
    const html = renderToStaticMarkup(
      <ActivityFeed
        events={[
          event({
            type: 'workspace.renamed',
            actor: { name: 'Sarah Chen' },
            target: { type: 'workspace' },
            context: { workspace_name: 'Harbor Docs' },
          }),
        ]}
      />,
    );
    expect(html).toContain('renamed the workspace to');
    expect(html).toContain('Harbor Docs');
    expect(html).toContain('href="/settings"');
  });
});

describe('ActivityFeed re-sync digest (1A)', () => {
  it('renders a busy re-sync as one line with all three counts', () => {
    const html = renderToStaticMarkup(
      <ActivityFeed
        events={[
          event({
            type: 'reanchor.completed',
            actor: { name: null },
            context: { document_title: 'rfc-017.mdx', anchored: 28, relocated: 2, orphaned: 1 },
          }),
        ]}
      />,
    );
    // One row, one sentence, all counts.
    expect(html).toContain('Re-synced');
    expect(html).toContain('28 anchored, 2 relocated, 1 orphaned');
    // Exactly one list item — never one row per thread.
    expect(html.match(/<li/g)?.length).toBe(1);
  });
});

describe('ActivityFeed safety and links', () => {
  it('renders an untrusted document title inert (normal React escaping)', () => {
    const html = renderToStaticMarkup(
      <ActivityFeed
        events={[
          event({
            type: 'document.imported',
            context: { document_title: '<img src=x onerror=alert(1)>' },
          }),
        ]}
      />,
    );
    // The markup never becomes a real tag/attribute — it is escaped text.
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('drops the link (not the row) when the target is dead', () => {
    const html = renderToStaticMarkup(
      <ActivityFeed
        events={[
          event({
            type: 'comment.created',
            target: null,
            context: { document_title: 'Deleted doc', section: 'Intro' },
          }),
        ]}
      />,
    );
    // The sentence still renders from the snapshot…
    expect(html).toContain('Deleted doc § Intro');
    expect(html).toContain('commented on');
    // …but there is no link to a document.
    expect(html).not.toContain('href="/documents/');
  });

  it('formats the timestamp as relative time', () => {
    const html = renderToStaticMarkup(
      <ActivityFeed
        events={[event({ type: 'document.imported', context: { document_title: 'New RFC' } })]}
      />,
    );
    expect(html).toContain('12m ago');
  });
});
