import { renderToStaticMarkup } from './render-intl';
import { describe, expect, it } from 'vitest';
import { ProjectsRail } from '@/components/app/projects-rail';
import { unfiledDocumentCount } from '@/lib/projects-rail';
import type { Project, WorkspaceSummary } from '@/lib/document-types';

// The dashboard projects rail (#104). Two seams: the pure Unfiled-count
// derivation (total − Σ filed, the one bit of arithmetic the rail owns), and the
// static markup of the cards, the Unfiled bucket, and the ghosted M5 card.

describe('unfiledDocumentCount', () => {
  it('derives the bucket as total minus the sum of every project doc count', () => {
    // 8 documents; 6 filed across two projects → 2 Unfiled.
    expect(
      unfiledDocumentCount(summary({ total: 8 }), [
        project({ documents_count: 4 }),
        project({ documents_count: 2 }),
      ]),
    ).toBe(2);
  });

  it('is the full total when there are no projects — everything is Unfiled', () => {
    expect(unfiledDocumentCount(summary({ total: 5 }), [])).toBe(5);
  });

  it('treats an absent documents_count as zero, never NaN', () => {
    // A just-created project (added client-side) has no counts yet.
    expect(unfiledDocumentCount(summary({ total: 3 }), [project({})])).toBe(3);
  });

  it('clamps at 0 so a live-summary / seeded-projects skew never goes negative', () => {
    // The summary refreshes on settle (6A); the seeded project counts do not — a
    // momentary Σ filed > total must read 0, not −1.
    expect(
      unfiledDocumentCount(summary({ total: 1 }), [project({ documents_count: 3 })]),
    ).toBe(0);
  });

  it('returns null when the summary is absent (A1) — the caller drops the count', () => {
    expect(unfiledDocumentCount(null, [project({ documents_count: 2 })])).toBeNull();
  });
});

describe('ProjectsRail', () => {
  it('renders a card per project with its doc/open/orphan counts, linking to the page', () => {
    const html = renderToStaticMarkup(
      <ProjectsRail
        projects={[
          project({
            id: 7,
            name: 'Anchoring',
            documents_count: 6,
            open_threads_count: 11,
            orphaned_threads_count: 1,
          }),
        ]}
        summary={summary({ total: 8 })}
      />,
    );

    expect(html).toContain('Anchoring');
    expect(html).toContain('href="/projects/7"');
    expect(html).toContain('6 docs');
    expect(html).toContain('11 open');
    expect(html).toContain('1 orphan');
  });

  it('shows only the doc count for a clean project — no zero open/orphan noise', () => {
    const html = renderToStaticMarkup(
      <ProjectsRail
        projects={[project({ name: 'Platform RFCs', documents_count: 3 })]}
        summary={summary({ total: 3 })}
      />,
    );

    expect(html).toContain('3 docs');
    expect(html).not.toContain('0 open');
    expect(html).not.toContain('0 orphan');
  });

  it('renders the Unfiled bucket with its derived count and the ghosted M5 card', () => {
    const html = renderToStaticMarkup(
      <ProjectsRail
        projects={[project({ name: 'Anchoring', documents_count: 6 })]}
        summary={summary({ total: 8 })}
      />,
    );

    expect(html).toContain('Unfiled');
    expect(html).toContain('2 docs'); // 8 total − 6 filed
    expect(html).toContain('docs land here until assigned');
    // The honest roadmap ghost.
    expect(html).toContain('Review queue');
    expect(html).toContain('M5');
  });

  it('keeps the Unfiled card but drops its count when the summary is absent (A1)', () => {
    const html = renderToStaticMarkup(
      <ProjectsRail projects={[project({ name: 'Anchoring', documents_count: 6 })]} summary={null} />,
    );

    expect(html).toContain('Unfiled');
    expect(html).toContain('docs land here until assigned');
    // No derived count leaks — the bucket stands without a number.
    expect(html).not.toContain('2 docs');
  });

  it('drops the Unfiled count when the projects read degraded — even with a healthy summary', () => {
    // A failed projects seed returns [] (indistinguishable from an empty
    // workspace). Deriving from it would read every document as Unfiled; the
    // degraded flag suppresses the count so the rail never asserts a wrong total.
    const html = renderToStaticMarkup(
      <ProjectsRail projects={[]} summary={summary({ total: 8 })} degraded />,
    );

    expect(html).toContain('Unfiled');
    expect(html).not.toContain('8 docs');
  });
});

function summary(overrides: { total: number }): WorkspaceSummary {
  return {
    documents: {
      total: overrides.total,
      importing: 0,
      needs_attention: 0,
      lifecycle: { draft: 0, in_review: 0, approved: 0, superseded: 0 },
    },
    threads: { open: 0, orphaned: 0 },
    approvals: { stale: 0 },
  };
}

function project(overrides: Partial<Project>): Project {
  return {
    id: 1,
    name: 'Untitled',
    slug: 'untitled',
    description: null,
    created_at: null,
    ...overrides,
  };
}
