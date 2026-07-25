import { describe, expect, it } from 'vitest';
import { negotiateLocale } from '@/lib/i18n/negotiate';

// Locale negotiation matrix (eng-review 4A). The three headline rows the ticket
// names — allowlisted cookie wins, garbage cookie falls through, unsupported lands
// on en-US — plus the Accept-Language matching rules that back them.
describe('negotiateLocale', () => {
  it('an allowlisted cookie wins over Accept-Language', () => {
    expect(
      negotiateLocale({ cookie: 'de-DE', acceptLanguage: 'en-US,en;q=0.9' }),
    ).toBe('de-DE');
    expect(
      negotiateLocale({ cookie: 'mn-MN', acceptLanguage: 'es-US' }),
    ).toBe('mn-MN');
  });

  it('a garbage cookie falls through to Accept-Language', () => {
    expect(
      negotiateLocale({ cookie: 'xx-YY', acceptLanguage: 'es-ES,es;q=0.9' }),
    ).toBe('es-US');
    // A non-canonical casing of a supported tag is NOT on the strict allowlist,
    // so it too falls through — and here Accept-Language rescues it.
    expect(
      negotiateLocale({ cookie: 'DE-de', acceptLanguage: 'de-DE' }),
    ).toBe('de-DE');
  });

  it('an unsupported language lands on en-US', () => {
    expect(
      negotiateLocale({ cookie: null, acceptLanguage: 'fr-FR,ja;q=0.8' }),
    ).toBe('en-US');
    // Garbage cookie AND unusable Accept-Language → the terminal default.
    expect(
      negotiateLocale({ cookie: 'garbage', acceptLanguage: 'fr-FR' }),
    ).toBe('en-US');
  });

  it('matches Accept-Language exactly, then by primary subtag', () => {
    expect(negotiateLocale({ acceptLanguage: 'mn-MN' })).toBe('mn-MN');
    expect(negotiateLocale({ acceptLanguage: 'de' })).toBe('de-DE');
    expect(negotiateLocale({ acceptLanguage: 'es-419' })).toBe('es-US');
    expect(negotiateLocale({ acceptLanguage: 'en-GB' })).toBe('en-US');
    // Case-insensitive header matching.
    expect(negotiateLocale({ acceptLanguage: 'DE-DE' })).toBe('de-DE');
  });

  it('honors q-value ranking, then header order as the tiebreak', () => {
    expect(
      negotiateLocale({ acceptLanguage: 'de;q=0.5,es;q=0.9' }),
    ).toBe('es-US');
    expect(
      negotiateLocale({ acceptLanguage: 'fr;q=1.0,mn;q=0.7,de;q=0.7' }),
    ).toBe('mn-MN');
  });

  it('ignores out-of-range and malformed q-values (RFC 7231), never promoting them to 1', () => {
    // q=2 is invalid (max 1), so German is dropped and Spanish (valid 0.9) wins —
    // NOT German by a bogus weight of 2.
    expect(
      negotiateLocale({ acceptLanguage: 'de;q=2, es;q=0.9' }),
    ).toBe('es-US');
    // A malformed weight is ignored, not silently treated as the default 1.
    expect(
      negotiateLocale({ acceptLanguage: 'de;q=abc, es;q=0.5' }),
    ).toBe('es-US');
    // Case-insensitive q parameter; a valid weight still counts.
    expect(negotiateLocale({ acceptLanguage: 'de;Q=0.8' })).toBe('de-DE');
    // Every tag carrying an invalid weight → nothing usable → en-US default.
    expect(negotiateLocale({ acceptLanguage: 'de;q=2, es;q=5' })).toBe('en-US');
  });

  it('defaults to en-US with no signals at all', () => {
    expect(negotiateLocale({})).toBe('en-US');
    expect(negotiateLocale({ cookie: '', acceptLanguage: '' })).toBe('en-US');
    expect(negotiateLocale({ cookie: null, acceptLanguage: null })).toBe('en-US');
    // A wildcard-only header carries no real preference.
    expect(negotiateLocale({ acceptLanguage: '*' })).toBe('en-US');
  });
});
