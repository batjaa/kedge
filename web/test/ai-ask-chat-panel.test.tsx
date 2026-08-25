import { describe, expect, it } from 'vitest';
import { AskChatBody } from '@/components/app/ai-ask-chat-panel';
import type { AskTurn } from '@/lib/ask-conversation';
import type { AiRun, AskOutput } from '@/lib/ai-types';
import type { AskConversation } from '@/lib/use-ask-conversation';
import { renderToStaticMarkup } from './render-intl';

// The ask chat's render seam (#151). What is asserted here is what the panel
// PROMISES: which voice is which, that a run's coverage is printed verbatim,
// that every failure lands on the turn that failed, and — the one that matters
// most — that there is still no way to turn an answer into review data.

function run(overrides: Partial<AiRun<AskOutput>> = {}): AiRun<AskOutput> {
  return {
    id: 1,
    document_id: 7,
    type: 'ask',
    variant: null,
    status: 'completed',
    model: 'claude-sonnet-5',
    tokens: 900,
    cost: 0.01,
    output: {
      answer: 'The anchor is re-resolved against the new version, not recreated.',
      coverage: { covered: 12, total: 12, chunked: false, statement: 'Covers all 12 passages.' },
    },
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function turn(overrides: Partial<AskTurn> = {}): AskTurn {
  return {
    id: 1,
    question: 'How does re-anchoring work?',
    quote: null,
    starting: false,
    run: run(),
    startFailure: null,
    ...overrides,
  };
}

function conversation(overrides: Partial<AskConversation> = {}): AskConversation {
  return {
    turns: [],
    pendingQuote: null,
    busy: false,
    pollRunId: null,
    ask: () => true,
    retry: () => {},
    attachQuote: () => {},
    clearPendingQuote: () => {},
    reset: () => {},
    settle: () => {},
    ...overrides,
  };
}

function render(overrides: Partial<AskConversation> = {}): string {
  return renderToStaticMarkup(
    <AskChatBody conversation={conversation(overrides)} onClose={() => {}} />,
  );
}

describe('ask chat panel', () => {
  it('renders a conversation of accumulated turns, not one answer replacing another', () => {
    const html = render({
      turns: [
        turn({ id: 1, question: 'What is an anchor?', run: run({ id: 1, output: {
          answer: 'A quote plus the text around it.',
          coverage: { covered: 2, total: 2, chunked: false, statement: 'Covers all 2 passages.' },
        } }) }),
        turn({ id: 2, question: 'And on a re-sync?' }),
      ],
    });

    expect(html).toContain('What is an anchor?');
    expect(html).toContain('A quote plus the text around it.');
    expect(html).toContain('And on a re-sync?');
    expect(html).toContain('re-resolved against the new version');
  });

  it('separates the human voice from the model voice in both themes', () => {
    // #143's register: the reader's turn is zinc, the model's is violet, and
    // both themes say so — the light-mode fallback to a zinc primary is exactly
    // the bug that ticket fixed.
    const html = render({ turns: [turn()] });

    expect(html).toContain('bg-violet-50');
    expect(html).toContain('dark:bg-violet-400/10');
    expect(html).toContain('text-violet-700');
    expect(html).toContain('dark:text-violet-300');
    // The human turn keeps the neutral register.
    expect(html).toContain('bg-zinc-100');
  });

  it('wears the agent register on the send CTA', () => {
    const html = render();

    const send = html.slice(html.indexOf('Send') - 800, html.indexOf('Send'));
    expect(send).toContain('violet');
  });

  it('prints the run&apos;s coverage statement verbatim', () => {
    const html = render({
      turns: [turn({
        run: run({
          output: {
            answer: 'What I could read says this.',
            coverage: {
              covered: 8,
              total: 40,
              chunked: false,
              statement:
                'Covers 8 of 40 passages — the review was too large to read in full. The conversation so far is sent with every question, so a longer conversation leaves less room for the document.',
            },
          },
        }),
      })],
    });

    expect(html).toContain('Covers 8 of 40 passages');
    expect(html).toContain('leaves less room for the document');
  });

  it('says nothing is posted to the review, and names the model that answered', () => {
    const html = render({ turns: [turn()] });

    expect(html).toContain('Nothing is posted to the review');
    expect(html).toContain('claude-sonnet-5');
  });

  it('offers no way to turn an answer into review data', () => {
    // Hard rule 5 at the render seam. Every control in the panel either sends a
    // question, retries one, copies text, closes the panel, or starts a new
    // conversation — and no api endpoint exists that could serve a post button
    // if a later refactor added one.
    const html = render({ turns: [turn()] }).toLowerCase();

    expect(html).not.toContain('post ');
    expect(html).not.toContain('reply');
    expect(html).not.toContain('suggest');
    expect(html).not.toContain('comment');
  });

  it('shows a pending turn as thinking, under the model voice', () => {
    const html = render({
      turns: [turn({ starting: true, run: null })],
      busy: true,
    });

    expect(html).toContain('Reading the document…');
    expect(html).toContain('role="status"');
  });

  it('lands a deterministic failure on its own turn, with no retry that cannot work', () => {
    const html = render({
      turns: [
        turn({ id: 1 }),
        turn({
          id: 2,
          question: 'And this one?',
          run: run({
            id: 2,
            status: 'failed',
            output: null,
            error: { kind: 'deterministic', code: 'unparseable_output', message: 'The model returned nothing usable.' },
          }),
        }),
      ],
    });

    // The earlier answer is untouched — a failure three turns ago must not look
    // like the current turn failed.
    expect(html).toContain('re-resolved against the new version');
    expect(html).toContain('The model returned nothing usable.');
    expect(html).not.toContain('Retry');
  });

  it('offers a retry on a transient failure, in the agent register', () => {
    const html = render({
      turns: [turn({
        run: run({
          status: 'failed',
          output: null,
          error: { kind: 'transient', code: 'provider_overloaded', message: 'The provider is busy.' },
        }),
      })],
    });

    expect(html).toContain('The provider is busy.');
    expect(html).toContain('Retry');
    // Retry starts a model run, so it wears violet — DESIGN.md's rule is about
    // what the click leads to, not about the control being a "primary" (#143).
    const retry = html.slice(0, html.indexOf('Retry'));
    expect(retry.slice(-600)).toContain('violet');
  });

  it('offers a retry once a run outlives the client ceiling, so a dead worker cannot wedge the chat', () => {
    // A worker killed hard enough never runs its terminal handler, so this run
    // will never settle on its own. Without a way out, the composer stays
    // disabled until the reader discards the whole conversation.
    const html = render({
      turns: [turn({
        run: run({
          status: 'running',
          output: null,
          created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
        }),
      })],
      busy: true,
    });

    expect(html).toContain('taking longer than expected');
    expect(html).toContain('Retry');
  });

  it('offers retry only on the last turn', () => {
    // Retrying an earlier turn would slot its answer in front of answers
    // written without it, and every later request would replay the pair in
    // display order as though that ordering were causal.
    const failure = {
      run: run({
        status: 'failed',
        output: null,
        error: { kind: 'transient' as const, code: 'provider_overloaded', message: 'The provider is busy.' },
      }),
    };

    const lastFailed = render({ turns: [turn({ id: 1 }), turn({ id: 2, ...failure })] });
    expect(lastFailed).toContain('Retry');

    const middleFailed = render({ turns: [turn({ id: 1, ...failure }), turn({ id: 2 })] });
    expect(middleFailed).toContain('The provider is busy.');
    expect(middleFailed).not.toContain('Retry');
  });

  it('renders a 429 in the chat rather than wedging the panel', () => {
    const html = render({
      turns: [turn({
        run: null,
        startFailure: { ok: false, kind: 'rate-limited', message: 'Too many requests. Wait a minute, then try again.' },
      })],
    });

    expect(html).toContain('Too many questions in a row');
    // Retryable — a rate limit is not the question's fault and WILL clear.
    expect(html).toContain('Retry');
    // And the composer is still there to type the next question into.
    expect(html).toContain('Your question');
  });

  it('shows the pending passage as a removable chip, not as part of the question', () => {
    const html = render({
      pendingQuote: { exact: 'Re-anchoring keeps a comment attached across versions.', heading_path: ['Anchoring RFC'] },
    });

    expect(html).toContain('Selected passage');
    expect(html).toContain('Re-anchoring keeps a comment attached');
    expect(html).toContain('Remove the selected passage');
  });

  it('offers New conversation only once there is a conversation to clear', () => {
    expect(render()).not.toContain('New conversation');
    expect(render({ turns: [turn()] })).toContain('New conversation');
  });
});
