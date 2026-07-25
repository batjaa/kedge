import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRelativeTime } from '@/lib/intl-time';

// The locale-aware relative-time helper (M3.9 #123): Intl.RelativeTimeFormat on
// the active locale, with lib/relative-time.ts's exact unit ladder (minutes →
// hours → days, floor 1 minute). Assertions stay loose where CLDR owns the
// wording — the contract is "localized by Intl", not a frozen string that
// breaks on an ICU data update — but each locale must visibly differ from raw
// English suffix-gluing.

const NOW = new Date('2026-07-24T12:00:00Z');

function iso(minutesAgo: number): string {
  return new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
}

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('walks the minute → hour → day ladder on en-US', () => {
    // Narrow style wording varies by ICU version ("5m ago" / "5 min. ago") —
    // pin the unit letter and the "ago" phrasing, not the exact CLDR string.
    expect(formatRelativeTime(iso(5), 'en-US')).toMatch(/5\s?m.*ago/i);
    expect(formatRelativeTime(iso(3 * 60), 'en-US')).toMatch(/3\s?h.*ago/i);
    expect(formatRelativeTime(iso(2 * 24 * 60), 'en-US')).toMatch(/2\s?d.*ago/i);
  });

  it('floors a fresh timestamp at one minute, matching the English helper', () => {
    expect(formatRelativeTime(iso(0), 'en-US')).toMatch(/1\s?m.*ago/i);
  });

  it('renders German via CLDR ("vor …"), not an English suffix', () => {
    const de = formatRelativeTime(iso(5), 'de-DE');
    expect(de).toContain('5');
    expect(de.toLowerCase()).toContain('vor');
    expect(de).not.toMatch(/ago/i);
  });

  it('renders Spanish via CLDR ("hace …")', () => {
    const es = formatRelativeTime(iso(5), 'es-US');
    expect(es).toContain('5');
    expect(es.toLowerCase()).toContain('hace');
  });

  it('renders Mongolian Cyrillic via CLDR ("… өмнө")', () => {
    const mn = formatRelativeTime(iso(5), 'mn-MN');
    expect(mn).toContain('5');
    expect(mn).toContain('өмнө');
  });

  it('returns the empty string for null and invalid input', () => {
    expect(formatRelativeTime(null, 'en-US')).toBe('');
    expect(formatRelativeTime('not-a-date', 'en-US')).toBe('');
  });

  it('degrades a malformed locale tag to English instead of throwing', () => {
    expect(formatRelativeTime(iso(5), 'no such locale!!')).toMatch(/5\s?m.*ago/i);
  });
});
