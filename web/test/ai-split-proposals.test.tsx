import { describe, expect, it } from 'vitest';
import { AiSplitProposals } from '@/components/app/ai-split-proposals';
import {
  initialSplitApprovals,
  markSplitApproved,
  markSplitFailed,
  type SplitApprovals,
} from '@/lib/ai-split';
import type { SplitOutput } from '@/lib/ai-types';
import { renderToStaticMarkup } from './render-intl';

function output(overrides: Partial<SplitOutput> = {}): SplitOutput {
  return {
    proposals: [
      {
        title: 'Budget number',
        fragment: 'The budget needs a real number.',
        anchor: {
          exact: 'The budget section needs a number.',
          prefix: '',
          suffix: '',
          start: 13,
          end: 47,
          heading_path: ['Doc'],
          projection_version: '2',
        },
      },
      {
        title: 'Anchoring example',
        fragment: 'The anchoring rules need an example.',
        anchor: null,
      },
    ],
    coverage: { covered: 1, total: 1, chunked: false, statement: 'Covers all 1 comment.' },
    ...overrides,
  };
}

function render(out: SplitOutput = output(), approvals?: SplitApprovals, locale?: 'de-DE') {
  return renderToStaticMarkup(
    <AiSplitProposals
      output={out}
      approvals={approvals ?? initialSplitApprovals(out.proposals.length)}
      model="claude-sonnet-5"
      busy={false}
      onApprove={() => {}}
      onApproveAll={() => {}}
    />,
    locale,
  );
}

describe('AiSplitProposals', () => {
  it('renders a title, a fragment, and the anchored quote per proposal', () => {
    const html = render();

    expect(html).toContain('Budget number');
    expect(html).toContain('The budget needs a real number.');
    expect(html).toContain('The budget section needs a number.');
    expect(html).toContain('Anchoring example');
  });

  it('says so when a proposal carries no anchor of its own', () => {
    expect(render()).toContain("Keeps the original thread&#x27;s selection.");
  });

  /**
   * The fork mechanism copies the whole comment into each new thread; the title
   * and fragment explain WHY a thread exists, they are not its body. The panel
   * must not imply otherwise — an affordance that lies about its own effect is
   * worse than no affordance.
   */
  it('says plainly what approving actually does', () => {
    const html = render();

    expect(html).toContain('the comment is carried over whole');
    expect(html).toContain('Raised in');
    expect(html).toContain('Anchors to');
  });

  it('offers approve per split and approve-all over what is left', () => {
    const html = render();

    expect(html).toContain('Approve all (2)');
    expect(html.match(/>Approve</g) ?? []).toHaveLength(2);
    expect(html).toContain('0 of 2 approved');
  });

  it('keeps the rejected proposal approvable and shows its reason', () => {
    const approvals = markSplitFailed(
      markSplitApproved(initialSplitApprovals(2), 0),
      1,
      'The document changed since this text was selected.',
    );
    const html = render(output(), approvals);

    expect(html).toContain('1 of 2 approved');
    expect(html).toContain('The document changed since this text was selected.');
    // The approved one is a tick; the failed one still has its button.
    expect(html).toContain('Approved');
    expect(html).toContain('Approve all (1)');
    expect(html.match(/>Approve</g) ?? []).toHaveLength(1);
  });

  it('drops approve-all once nothing is left to approve', () => {
    const approvals = markSplitApproved(markSplitApproved(initialSplitApprovals(2), 0), 1);
    const html = render(output(), approvals);

    expect(html).not.toContain('Approve all');
    expect(html).toContain('2 of 2 approved');
  });

  it('prints the run&apos;s coverage statement verbatim', () => {
    expect(render()).toContain('Covers all 1 comment.');
  });

  it('says nothing has been created yet', () => {
    const html = render();

    expect(html).toContain('claude-sonnet-5');
    expect(html).toContain('Nothing has been created yet.');
  });

  it('shows an honest empty state when the comment reads as one issue', () => {
    const html = render(output({ proposals: [] }));

    expect(html).toContain('nothing to split');
    expect(html).not.toContain('Approve all');
  });

  it('localizes its chrome while leaving the run&apos;s own sentences alone', () => {
    const html = render(output(), undefined, 'de-DE');

    expect(html).toContain('Freigeben');
    expect(html).toContain('Covers all 1 comment.');
  });
});
