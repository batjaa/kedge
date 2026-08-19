import { describe, expect, it } from 'vitest';
import { AI_SUMMARY_MIN_COMMENTS, isLongThread, replyDraftLanding } from '@/lib/ai-triage';

/**
 * The landing rule (M4 #133, gap G12). These assertions are the contract that
 * keeps a generated draft from eating a person's half-written reply — the one
 * place in the AI surface where a bug destroys work rather than wasting a call.
 */
describe('replyDraftLanding', () => {
  it('inserts straight into an empty composer', () => {
    expect(replyDraftLanding({ composerBody: '', generated: 'Agreed — I will pin the version.' }))
      .toEqual({ action: 'insert', body: 'Agreed — I will pin the version.' });
  });

  it('treats a whitespace-only composer as empty', () => {
    expect(replyDraftLanding({ composerBody: '   \n\t ', generated: 'Drafted reply.' }))
      .toEqual({ action: 'insert', body: 'Drafted reply.' });
  });

  it('never replaces typed text without an explicit confirmation', () => {
    expect(replyDraftLanding({ composerBody: 'Half a thought I was still', generated: 'Drafted reply.' }))
      .toEqual({ action: 'confirm', body: 'Drafted reply.' });
  });

  it('asks before replacing even when the two texts are similar', () => {
    // No "close enough" shortcut: the decision belongs to the person, not to a
    // string comparison.
    expect(replyDraftLanding({ composerBody: 'Drafted reply.', generated: 'Drafted reply!' }))
      .toEqual({ action: 'confirm', body: 'Drafted reply!' });
  });

  it('discards an empty generation rather than wiping the composer with it', () => {
    expect(replyDraftLanding({ composerBody: 'My own words', generated: '   ' }))
      .toEqual({ action: 'discard' });
    expect(replyDraftLanding({ composerBody: '', generated: '' }))
      .toEqual({ action: 'discard' });
  });

  it('trims the generated text it hands over', () => {
    expect(replyDraftLanding({ composerBody: '', generated: '\n  Drafted reply.  \n' }))
      .toEqual({ action: 'insert', body: 'Drafted reply.' });
  });
});

describe('isLongThread', () => {
  it('offers a summary only once a thread is worth summarizing', () => {
    expect(isLongThread(0)).toBe(false);
    expect(isLongThread(AI_SUMMARY_MIN_COMMENTS - 1)).toBe(false);
    expect(isLongThread(AI_SUMMARY_MIN_COMMENTS)).toBe(true);
    expect(isLongThread(40)).toBe(true);
  });
});
