import { describe, expect, it } from 'vitest';
import { DocumentCommentComposer, type ComposerState } from '@/components/app/document-comment-composer';
import { renderToStaticMarkup } from './render-intl';

const SELECTION: ComposerState = {
  open: true,
  stage: 'affordance',
  mode: 'inline',
  anchor: {
    exact: 'Re-anchoring keeps a comment attached across versions.',
    prefix: '',
    suffix: '',
    start: 40,
    end: 94,
    heading_path: ['Anchoring RFC'],
    projection_version: 2,
  },
  failure: null,
  x: 200,
  y: 120,
};

function render(onAsk?: () => void): string {
  return renderToStaticMarkup(
    <DocumentCommentComposer
      documentId={7}
      composer={SELECTION}
      commentType="comment"
      body=""
      proposedText=""
      message={null}
      submitting={false}
      onBodyChange={() => {}}
      onProposedTextChange={() => {}}
      onCommentTypeChange={() => {}}
      onClose={() => {}}
      onOpenPanel={() => {}}
      onAsk={onAsk}
      onSubmit={() => {}}
    />,
  );
}

describe('selection affordance', () => {
  it('offers ask alongside comment when AI is enabled', () => {
    const html = render(() => {});

    expect(html).toContain('Comment');
    expect(html).toContain('Ask AI');
  });

  it('offers no ask affordance at all when AI is disabled', () => {
    // Fail-closed, like every AI surface: a keyless instance shows no teaser and
    // no dead button — the affordance simply does not exist.
    const html = render(undefined);

    expect(html).toContain('Comment');
    expect(html).not.toContain('Ask AI');
  });
});
