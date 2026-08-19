import { describe, expect, it } from 'vitest';
import { AskAnswer } from '@/components/app/ai-ask-action';
import type { AskOutput } from '@/lib/ai-types';
import { renderToStaticMarkup } from './render-intl';

function output(overrides: Partial<AskOutput> = {}): AskOutput {
  return {
    answer: 'The document says the anchor is re-resolved against the new version, not recreated.',
    coverage: { covered: 12, total: 12, chunked: false, statement: 'Covers all 12 passages.' },
    ...overrides,
  };
}

describe('AskAnswer', () => {
  it('renders the answer', () => {
    const html = renderToStaticMarkup(<AskAnswer output={output()} model="claude-sonnet-5" />);

    expect(html).toContain('re-resolved against the new version');
  });

  it('prints the run&apos;s coverage statement verbatim', () => {
    const partial = renderToStaticMarkup(
      <AskAnswer
        output={output({
          coverage: {
            covered: 8,
            total: 40,
            chunked: false,
            statement:
              'Covers 8 of 40 passages — the review was too large to read in full. The answer was written from the start of the document; the rest was too large to read in this pass.',
          },
        })}
        model={null}
      />,
    );

    expect(partial).toContain('Covers 8 of 40 passages');
    expect(partial).toContain('the rest was too large to read in this pass');
  });

  it('says nothing was posted and nothing is saved, naming the model when there is one', () => {
    const withModel = renderToStaticMarkup(<AskAnswer output={output()} model="claude-sonnet-5" />);
    const withoutModel = renderToStaticMarkup(<AskAnswer output={output()} model={null} />);

    expect(withModel).toContain('claude-sonnet-5');
    expect(withModel).toContain('Nothing was posted');
    expect(withModel).toContain('not saved');
    expect(withoutModel).toContain('Nothing was posted');
    expect(withoutModel).not.toContain('claude-sonnet-5');
  });

  it('offers no way to turn the answer into review data', () => {
    // Hard rule 5 at the render seam: the panel is a place to READ. There is no
    // post, no reply, no "open a thread with this" — and no api endpoint that
    // could serve one if a later refactor added the button.
    const html = renderToStaticMarkup(<AskAnswer output={output()} model={null} />).toLowerCase();

    expect(html).not.toContain('<button');
    expect(html).not.toContain('post ');
    expect(html).not.toContain('reply');
  });
});
