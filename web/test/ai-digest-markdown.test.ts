import { describe, expect, it } from 'vitest';
import { digestToMarkdown, type DigestMarkdownLabels } from '@/lib/ai-digest-markdown';
import type { DigestOutput } from '@/lib/ai-types';

const LABELS: DigestMarkdownLabels = {
  title: 'Review digest — Anchoring RFC',
  themes: 'Themes',
  contentionPoints: 'Contention points',
  consensus: 'Consensus',
  actionItems: 'Action items',
  empty: 'None.',
};

function output(overrides: Partial<DigestOutput> = {}): DigestOutput {
  return {
    themes: [{ title: 'Anchoring', summary: 'Reviewers keep returning to anchor survival.' }],
    contention_points: [],
    consensus: [{ title: 'Kroki', summary: 'Everyone agrees Kroki stays the only engine.' }],
    action_items: [{ title: 'Clarify the budget', summary: 'Say what happens over budget.' }],
    coverage: { covered: 12, total: 20, chunked: true, statement: 'Covers 12 of 20 threads.' },
    ...overrides,
  };
}

describe('digestToMarkdown', () => {
  it('serializes every section under a heading, in render order', () => {
    const markdown = digestToMarkdown(output(), LABELS);

    expect(markdown).toBe(
      [
        '# Review digest — Anchoring RFC',
        '',
        '_Covers 12 of 20 threads._',
        '',
        '## Themes',
        '',
        '- **Anchoring** — Reviewers keep returning to anchor survival.',
        '',
        '## Contention points',
        '',
        '_None._',
        '',
        '## Consensus',
        '',
        '- **Kroki** — Everyone agrees Kroki stays the only engine.',
        '',
        '## Action items',
        '',
        '- **Clarify the budget** — Say what happens over budget.',
        '',
      ].join('\n'),
    );
  });

  it('carries the coverage statement verbatim so honesty survives the copy', () => {
    const partial = digestToMarkdown(output(), LABELS);
    const complete = digestToMarkdown(
      output({ coverage: { covered: 3, total: 3, chunked: false, statement: 'Covers all 3 threads.' } }),
      LABELS,
    );

    expect(partial).toContain('_Covers 12 of 20 threads._');
    expect(complete).toContain('_Covers all 3 threads._');
  });

  it('renders an empty review honestly rather than omitting the sections', () => {
    const markdown = digestToMarkdown(
      output({
        themes: [],
        consensus: [],
        action_items: [],
        coverage: {
          covered: 0,
          total: 0,
          chunked: false,
          statement: 'No review threads yet — nothing to digest.',
        },
      }),
      LABELS,
    );

    expect(markdown).toContain('_No review threads yet — nothing to digest._');
    expect(markdown.match(/_None\._/g)).toHaveLength(4);
  });
});
