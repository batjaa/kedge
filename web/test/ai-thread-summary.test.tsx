import { describe, expect, it } from 'vitest';
import { SummaryReport } from '@/components/app/ai-thread-summary';
import type { ThreadSummaryOutput } from '@/lib/ai-types';
import { renderToStaticMarkup } from './render-intl';

function output(overrides: Partial<ThreadSummaryOutput> = {}): ThreadSummaryOutput {
  return {
    current_state: 'Reviewers agree anchors must survive a re-sync; the storage shape is still argued.',
    open_question: 'Does a relocated anchor keep its original offsets?',
    coverage: { covered: 12, total: 40, chunked: false, statement: 'Covers 12 of 40 comments.' },
    ...overrides,
  };
}

describe('SummaryReport', () => {
  it('renders where the thread stands and what it is still waiting on', () => {
    const html = renderToStaticMarkup(<SummaryReport output={output()} model="claude-haiku-4-5" />);

    expect(html).toContain('Where it stands');
    expect(html).toContain('storage shape is still argued');
    expect(html).toContain('Open question');
    expect(html).toContain('Does a relocated anchor keep its original offsets?');
  });

  it('prints the run&apos;s coverage statement verbatim', () => {
    const html = renderToStaticMarkup(<SummaryReport output={output()} model={null} />);

    expect(html).toContain('Covers 12 of 40 comments.');
  });

  it('says the thread was left untouched, naming the model when there is one', () => {
    const withModel = renderToStaticMarkup(
      <SummaryReport output={output()} model="claude-haiku-4-5" />,
    );
    const withoutModel = renderToStaticMarkup(<SummaryReport output={output()} model={null} />);

    expect(withModel).toContain('claude-haiku-4-5');
    expect(withModel).toContain('Nothing in this thread changed.');
    expect(withoutModel).toContain('Nothing in this thread changed.');
    expect(withoutModel).not.toContain('claude-haiku-4-5');
  });

  it('falls back to the coverage line when nothing could be read', () => {
    const html = renderToStaticMarkup(
      <SummaryReport
        output={output({
          current_state: '',
          open_question: '',
          coverage: { covered: 0, total: 40, chunked: false, statement: 'Covers 0 of 40 comments — the review was too large to read in full.' },
        })}
        model={null}
      />,
    );

    expect(html).toContain('Covers 0 of 40 comments');
    expect(html).not.toContain('Where it stands');
  });
});
