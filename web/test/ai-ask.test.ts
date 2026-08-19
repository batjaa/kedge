import { describe, expect, it } from 'vitest';
import {
  ASK_QUOTE_PREVIEW_CHARS,
  MAX_ASK_QUESTION_CHARS,
  askQuestionIsAskable,
  askQuotePreview,
  askQuoteFromSelector,
} from '@/lib/ai-ask';
import type { AnchorSelector } from '@/lib/anchor-capture-core';

function selector(overrides: Partial<AnchorSelector> = {}): AnchorSelector {
  return {
    exact: 'Re-anchoring keeps a comment attached across versions.',
    prefix: 'before ',
    suffix: ' after',
    start: 40,
    end: 94,
    heading_path: ['Anchoring RFC', 'Survival'],
    projection_version: 2,
    ...overrides,
  };
}

describe('askQuestionIsAskable', () => {
  it('accepts a real question', () => {
    expect(askQuestionIsAskable('What happens on a re-sync?')).toBe(true);
  });

  it('refuses empty and whitespace-only text', () => {
    // The api trims and 422s these; asking anyway would bill the key to be told so.
    expect(askQuestionIsAskable('')).toBe(false);
    expect(askQuestionIsAskable('   \n\t ')).toBe(false);
  });

  it('refuses a question past the length the api accepts', () => {
    expect(askQuestionIsAskable('a'.repeat(MAX_ASK_QUESTION_CHARS))).toBe(true);
    expect(askQuestionIsAskable('a'.repeat(MAX_ASK_QUESTION_CHARS + 1))).toBe(false);
  });

  it('measures the trimmed question, so surrounding whitespace never pushes it over', () => {
    expect(askQuestionIsAskable(`  ${'a'.repeat(MAX_ASK_QUESTION_CHARS)}  `)).toBe(true);
  });
});

describe('askQuotePreview', () => {
  it('collapses the selection onto one line', () => {
    expect(askQuotePreview('a  passage\n  broken   over lines')).toBe('a passage broken over lines');
  });

  it('leaves a short passage whole', () => {
    expect(askQuotePreview('short passage')).toBe('short passage');
  });

  it('marks an elided preview, so a long selection never looks short', () => {
    const preview = askQuotePreview('x'.repeat(ASK_QUOTE_PREVIEW_CHARS + 50));

    expect(preview).toHaveLength(ASK_QUOTE_PREVIEW_CHARS + 1);
    expect(preview.endsWith('…')).toBe(true);
  });
});

describe('askQuoteFromSelector', () => {
  it('carries the passage and where it sits', () => {
    expect(askQuoteFromSelector(selector())).toEqual({
      exact: 'Re-anchoring keeps a comment attached across versions.',
      heading_path: ['Anchoring RFC', 'Survival'],
    });
  });

  it('drops the offsets and the projection version', () => {
    // An ask persists no anchor and re-anchors nothing, so there is nothing for
    // them to be validated against — sending them would imply a pin that isn't.
    const quote = askQuoteFromSelector(selector()) as unknown as Record<string, unknown>;

    expect(Object.keys(quote).sort()).toEqual(['exact', 'heading_path']);
    expect(quote.start).toBeUndefined();
    expect(quote.projection_version).toBeUndefined();
  });
});
