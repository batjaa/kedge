import { describe, expect, it } from 'vitest';
import { AiImprovePromptReport } from '@/components/app/ai-improve-prompt-report';
import { isDigestOutput, isImprovePromptOutput, type ImprovePromptOutput } from '@/lib/ai-types';
import { renderToStaticMarkup } from './render-intl';

const ARTIFACT = [
  '# Improve this document: Anchoring RFC',
  '',
  '## Required edits — accepted suggested edits, apply verbatim',
  '',
  '````text',
  'Anchors survive re-import.',
  '',
  '```php',
  "$fallback = 'quote';",
  '```',
  '````',
].join('\n');

function output(overrides: Partial<ImprovePromptOutput> = {}): ImprovePromptOutput {
  return {
    prompt: ARTIFACT,
    required_edits: 1,
    threads: 3,
    coverage: {
      covered: 2,
      total: 3,
      chunked: true,
      statement: 'Covers 2 of 3 open threads — the review was too large to read in full.',
    },
    ...overrides,
  };
}

describe('AiImprovePromptReport', () => {
  it('shows the artifact exactly as the run stored it', () => {
    const html = renderToStaticMarkup(<AiImprovePromptReport output={output()} model="claude-sonnet-5" />);

    // Verbatim, fences and all — the whole promise of the required-edits block.
    expect(html).toContain('Anchors survive re-import.');
    expect(html).toContain('````text');
    expect(html).toContain('$fallback = &#x27;quote&#x27;;');
  });

  it("prints the run's coverage statement verbatim", () => {
    const html = renderToStaticMarkup(<AiImprovePromptReport output={output()} model={null} />);

    expect(html).toContain('Covers 2 of 3 open threads — the review was too large to read in full.');
  });

  it('summarizes what the artifact speaks for', () => {
    const html = renderToStaticMarkup(<AiImprovePromptReport output={output()} model={null} />);

    expect(html).toContain('3 unresolved threads');
    expect(html).toContain('1 required edit');
  });

  it('says so, and offers nothing to copy, when the review had nothing unresolved', () => {
    const html = renderToStaticMarkup(
      <AiImprovePromptReport
        output={output({
          prompt: '',
          required_edits: 0,
          threads: 0,
          coverage: {
            covered: 0,
            total: 0,
            chunked: false,
            statement: 'No review open threads yet — nothing to turn into an improve-the-doc prompt.',
          },
        })}
        model={null}
      />,
    );

    expect(html).toContain('No review open threads yet — nothing to turn into an improve-the-doc prompt.');
    expect(html).toContain('nothing unresolved to ask for');
    expect(html).not.toContain('<pre');
  });

  it('says the output is a draft that posted nothing', () => {
    const withModel = renderToStaticMarkup(
      <AiImprovePromptReport output={output()} model="claude-sonnet-5" />,
    );
    const withoutModel = renderToStaticMarkup(<AiImprovePromptReport output={output()} model={null} />);

    expect(withModel).toContain('claude-sonnet-5');
    expect(withModel).toContain('Nothing was posted.');
    expect(withoutModel).toContain('Nothing was posted.');
  });

  it("localizes its chrome while leaving the run's own sentences alone", () => {
    const html = renderToStaticMarkup(<AiImprovePromptReport output={output()} model={null} />, 'de-DE');

    expect(html).toContain('Ein Entwurf zum Lesen und Einfügen');
    // The artifact and the coverage line are the server's words, not the UI's.
    expect(html).toContain('Anchors survive re-import.');
    expect(html).toContain('Covers 2 of 3 open threads — the review was too large to read in full.');
  });
});

describe('AI run output guards', () => {
  it('tells the two artifacts apart, and treats a missing output as neither', () => {
    const improve = output();
    const digest = {
      themes: [],
      contention_points: [],
      consensus: [],
      action_items: [],
      coverage: { covered: 0, total: 0, chunked: false, statement: 'x' },
    };

    expect(isImprovePromptOutput(improve)).toBe(true);
    expect(isImprovePromptOutput(digest)).toBe(false);
    expect(isDigestOutput(digest)).toBe(true);
    expect(isDigestOutput(improve)).toBe(false);
    expect(isImprovePromptOutput(null)).toBe(false);
    expect(isDigestOutput(null)).toBe(false);
  });
});
