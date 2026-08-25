import { describe, expect, it } from 'vitest';
import {
  MAX_ASK_TRANSCRIPT_CHARS,
  MAX_ASK_TRANSCRIPT_TURNS,
  askConversationIsBusy,
  askConversationPollRunId,
  askTurnIsPending,
  askTurnOutput,
  replayableTranscript,
  transcriptChars,
  type AskTurn,
} from '@/lib/ask-conversation';
import type { AiRun, AskOutput } from '@/lib/ai-types';

// The client half of the ask conversation's double cap (#151). The endpoint and
// the prompt builder each enforce these ceilings again; what is pinned here is
// that a normal page never sends a payload either of them would refuse, and
// that the panel keeps showing what the request had to leave behind.

function answered(id: number, question: string, answer: string): AskTurn {
  return {
    id,
    question,
    quote: null,
    starting: false,
    run: {
      id: id * 100,
      document_id: 7,
      type: 'ask',
      variant: null,
      status: 'completed',
      model: 'claude-sonnet-5',
      tokens: 100,
      cost: null,
      output: {
        answer,
        coverage: { covered: 1, total: 1, chunked: false, statement: 'Covers all 1 passage.' },
      },
      error: null,
      created_at: '2026-08-25T10:00:00Z',
      updated_at: '2026-08-25T10:00:01Z',
    } satisfies AiRun<AskOutput>,
    startFailure: null,
  };
}

function pending(id: number, question: string): AskTurn {
  return {
    id,
    question,
    quote: null,
    starting: false,
    run: {
      id: id * 100,
      document_id: 7,
      type: 'ask',
      variant: null,
      status: 'running',
      model: 'claude-sonnet-5',
      tokens: null,
      cost: null,
      output: null,
      error: null,
      created_at: '2026-08-25T10:00:00Z',
      updated_at: '2026-08-25T10:00:00Z',
    } satisfies AiRun<AskOutput>,
    startFailure: null,
  };
}

function failed(id: number, question: string): AskTurn {
  return {
    ...pending(id, question),
    run: null,
    startFailure: { ok: false, kind: 'rate-limited', message: 'Too many requests.' },
  };
}

describe('replayableTranscript', () => {
  it('carries the answered turns as question/answer pairs', () => {
    expect(replayableTranscript([
      answered(1, 'What is an anchor?', 'A quote plus its surroundings.'),
      answered(2, 'And on a re-sync?', 'It is re-resolved.'),
    ])).toEqual([
      { question: 'What is an anchor?', answer: 'A quote plus its surroundings.' },
      { question: 'And on a re-sync?', answer: 'It is re-resolved.' },
    ]);
  });

  it('replays nothing on the first question', () => {
    expect(replayableTranscript([])).toEqual([]);
  });

  it('leaves out turns with no answer', () => {
    // Replaying "the reader asked X" with nothing after it invites the model to
    // answer X again instead of the question actually being asked.
    const replay = replayableTranscript([
      answered(1, 'Answered.', 'Yes.'),
      pending(2, 'Still thinking.'),
      failed(3, 'Never started.'),
    ]);

    expect(replay).toEqual([{ question: 'Answered.', answer: 'Yes.' }]);
  });

  it('replays only the newest turns past the ceiling, keeping the rest on screen', () => {
    const turns = Array.from({ length: MAX_ASK_TRANSCRIPT_TURNS + 4 }, (_, index) =>
      answered(index + 1, `question ${index + 1}`, `answer ${index + 1}`));

    const replay = replayableTranscript(turns);

    expect(replay).toHaveLength(MAX_ASK_TRANSCRIPT_TURNS);
    // The oldest four are dropped from the REQUEST — the panel still holds all
    // twelve, which is why this function returns a payload rather than mutating
    // the turns.
    expect(replay[0].question).toBe('question 5');
    expect(replay.at(-1)?.question).toBe(`question ${turns.length}`);
    expect(turns).toHaveLength(MAX_ASK_TRANSCRIPT_TURNS + 4);
  });

  it('drops oldest-first until the payload fits the character ceiling', () => {
    const big = 'x'.repeat(6000);
    const turns = [
      answered(1, 'oldest', big),
      answered(2, 'middle', big),
      answered(3, 'newest', big),
    ];

    const replay = replayableTranscript(turns);

    expect(transcriptChars(replay)).toBeLessThanOrEqual(MAX_ASK_TRANSCRIPT_CHARS);
    expect(replay.map((entry) => entry.question)).toEqual(['middle', 'newest']);
  });

  it('sends nothing rather than a payload the endpoint would refuse', () => {
    // Stricter than the server's builder, which cuts a single irreducible turn
    // to keep something. The client's job is to never earn a 422 mid-conversation.
    const replay = replayableTranscript([
      answered(1, 'huge', 'y'.repeat(MAX_ASK_TRANSCRIPT_CHARS + 1)),
    ]);

    expect(replay).toEqual([]);
  });

  it('trims each half, so whitespace never counts toward the ceiling', () => {
    expect(replayableTranscript([answered(1, '  padded  ', '  answer  ')])).toEqual([
      { question: 'padded', answer: 'answer' },
    ]);
  });
});

describe('askTurnOutput', () => {
  it('returns the answer only once the run completed', () => {
    expect(askTurnOutput(answered(1, 'q', 'a'))?.answer).toBe('a');
    expect(askTurnOutput(pending(1, 'q'))).toBeNull();
    expect(askTurnOutput(failed(1, 'q'))).toBeNull();
  });
});

describe('askConversationIsBusy', () => {
  it('is true while a turn is starting or its run is in flight', () => {
    expect(askConversationIsBusy([answered(1, 'q', 'a')])).toBe(false);
    expect(askConversationIsBusy([answered(1, 'q', 'a'), pending(2, 'q')])).toBe(true);
    expect(askConversationIsBusy([{ ...answered(1, 'q', 'a'), starting: true }])).toBe(true);
  });

  it('is false once every turn is terminal, so a failure never wedges the composer', () => {
    expect(askConversationIsBusy([failed(1, 'q')])).toBe(false);
  });
});

describe('askConversationPollRunId', () => {
  it('names the one in-flight run, and nothing once it settles', () => {
    expect(askConversationPollRunId([answered(1, 'q', 'a'), pending(2, 'q')])).toBe(200);
    expect(askConversationPollRunId([answered(1, 'q', 'a')])).toBeNull();
    expect(askConversationPollRunId([failed(1, 'q')])).toBeNull();
  });
});

describe('askTurnIsPending', () => {
  it('covers the gap between the POST leaving and a run existing', () => {
    // The turn has no run yet, so a status check alone would call it settled.
    expect(askTurnIsPending({ ...answered(1, 'q', 'a'), starting: true, run: null })).toBe(true);
  });
});
