// The four supported UI locales (SPEC m3.9; user-directed at speccing). en-US is
// the authored source; es-US/de-DE are machine-seeded (native review gated before
// Launch) and mn-MN is founder-reviewed. Adding a locale later is deliberately
// cheap: one entry here + a catalog directory under messages/ (see messages/README.md).
//
// Order matters for the switcher (rendered top-to-bottom) and is the canonical
// negotiation order when Accept-Language q-values tie.
export const SUPPORTED_LOCALES = ['en-US', 'es-US', 'mn-MN', 'de-DE'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

// The authored source locale. Every other catalog is deep-merged UNDER this one
// (lib/i18n/messages.ts) so a missing key renders English, never a raw key path
// (eng-review B1). It is also the terminal fallback of locale negotiation (4A).
export const DEFAULT_LOCALE: Locale = 'en-US';

// The persisted-choice cookie. Named for the next-intl convention so a future
// migration to URL-routed locales (Launch tail; SPEC m3.9 Out of Scope) is a
// smaller step. Written only by the switcher's server action, and only ever with
// a value that passes isSupportedLocale — the read path (negotiation) revalidates
// regardless, so a hand-forged cookie can never smuggle an unsupported locale in.
export const LOCALE_COOKIE_NAME = 'NEXT_LOCALE';

// One year: a language choice is a durable preference, not a session detail.
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Strict allowlist membership test — the single gate every locale value passes
 * before it is trusted, on both the cookie-read (negotiation) and cookie-write
 * (server action) paths. Case-sensitive by design: the switcher only ever emits
 * the canonical tags above, so anything else is untrusted and falls through.
 */
export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}
