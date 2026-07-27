import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  SUPPORTED_LOCALES,
  type Locale,
} from './config';

// Locale negotiation (eng-review 4A), a pure function so the resolution matrix is
// unit-testable without a request. Precedence, highest first:
//
//   1. a cookie whose value is on the strict allowlist  → that locale (a manual
//      switcher choice always wins; never re-negotiated away from the user)
//   2. Accept-Language, best q-ranked tag that maps to a supported locale
//   3. en-US (the terminal default)
//
// A garbage or unsupported cookie is simply not on the allowlist, so it falls
// through to step 2 exactly as if absent — no cookie value is ever trusted on its
// face. Because the four supported locales have distinct primary subtags (en/es/
// mn/de), primary-subtag matching (`de` → de-DE, `es-419` → es-US) is unambiguous.

interface NegotiationInput {
  /** Raw cookie value (untrusted); null/undefined when unset. */
  cookie?: string | null;
  /** Raw Accept-Language header (untrusted); null/undefined when absent. */
  acceptLanguage?: string | null;
}

// RFC 7231 qvalue: 0-1 with up to three decimals. A weight outside this grammar
// (e.g. q=2, q=abc) is malformed, so we drop the tag rather than trust it —
// never silently promote it to the default weight of 1.
const QVALUE = /^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/;

/** Parse an Accept-Language header into language tags, best-preference first. */
function rankedTags(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      let q = 1;
      for (const param of params) {
        const trimmed = param.trim();
        if (/^q=/i.test(trimmed)) {
          const raw = trimmed.slice(2).trim();
          // A present-but-invalid weight means "ignore this tag" (q=0), not 1.
          q = QVALUE.test(raw) ? Number.parseFloat(raw) : 0;
        }
      }
      return { tag: tag.trim(), q };
    })
    .filter((entry) => entry.tag !== '' && entry.tag !== '*' && entry.q > 0)
    // Stable sort (V8): equal q-values keep header order, so a client's own
    // ordering is honored as the tiebreak.
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.tag);
}

/** Map one language tag to a supported locale: exact first, then primary subtag. */
function matchLocale(tag: string): Locale | null {
  const lower = tag.toLowerCase();
  const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === lower);
  if (exact) return exact;

  const primary = lower.split('-')[0];
  return (
    SUPPORTED_LOCALES.find(
      (locale) => locale.toLowerCase().split('-')[0] === primary,
    ) ?? null
  );
}

/**
 * Resolve the active locale from an (untrusted) cookie and Accept-Language header.
 * Always returns a supported locale; never throws.
 */
export function negotiateLocale({ cookie, acceptLanguage }: NegotiationInput): Locale {
  if (isSupportedLocale(cookie)) return cookie;

  for (const tag of rankedTags(acceptLanguage)) {
    const matched = matchLocale(tag);
    if (matched) return matched;
  }

  return DEFAULT_LOCALE;
}
