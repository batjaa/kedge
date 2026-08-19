import { describe, expect, it } from 'vitest';
import { AiDigestReport } from '@/components/app/ai-digest-report';
import type { DigestOutput } from '@/lib/ai-types';
import { renderToStaticMarkup } from './render-intl';

function output(overrides: Partial<DigestOutput> = {}): DigestOutput {
  return {
    themes: [{ title: 'Anchoring', summary: 'Reviewers keep returning to anchor survival.' }],
    contention_points: [],
    consensus: [],
    action_items: [{ title: 'Clarify the budget', summary: 'Say what happens over budget.' }],
    coverage: { covered: 12, total: 20, chunked: true, statement: 'Covers 12 of 20 threads.' },
    ...overrides,
  };
}

describe('AiDigestReport', () => {
  it('renders every category, with an honest empty marker for the unsupported ones', () => {
    const html = renderToStaticMarkup(<AiDigestReport output={output()} model="claude-sonnet-5" />);

    expect(html).toContain('Themes');
    expect(html).toContain('Anchoring');
    expect(html).toContain('Contention points');
    expect(html).toContain('None.');
    expect(html).toContain('Action items');
    expect(html).toContain('Clarify the budget');
  });

  it('prints the run&apos;s coverage statement verbatim', () => {
    const html = renderToStaticMarkup(<AiDigestReport output={output()} model={null} />);

    expect(html).toContain('Covers 12 of 20 threads.');
  });

  it('says the output is a draft that posted nothing', () => {
    const withModel = renderToStaticMarkup(
      <AiDigestReport output={output()} model="claude-sonnet-5" />,
    );
    const withoutModel = renderToStaticMarkup(<AiDigestReport output={output()} model={null} />);

    expect(withModel).toContain('claude-sonnet-5');
    expect(withModel).toContain('Nothing was posted.');
    expect(withoutModel).toContain('Nothing was posted.');
  });

  it('localizes its chrome while leaving the run&apos;s own sentences alone', () => {
    const html = renderToStaticMarkup(
      <AiDigestReport output={output()} model={null} />,
      'de-DE',
    );

    expect(html).toContain('Streitpunkte');
    // The coverage statement comes from the API, so it is not re-derived here.
    expect(html).toContain('Covers 12 of 20 threads.');
  });
});
