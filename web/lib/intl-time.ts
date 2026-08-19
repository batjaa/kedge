// Locale-aware time formatting for the app chrome (M3.9 #123): the compact
// relative-time idiom the rows and the activity feed use, rendered through
// Intl.RelativeTimeFormat on the ACTIVE locale — never hand-built suffixes, so
// CLDR owns the wording for es/de/mn. This is now the sole relative-time helper:
// #126 migrated the review surface here and removed the old locale-blind
// lib/relative-time.ts, so every timestamp in the app agrees on "how old" it is.

const formatters = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormatter(locale: string): Intl.RelativeTimeFormat {
  const cached = formatters.get(locale);
  if (cached) return cached;

  let formatter: Intl.RelativeTimeFormat;
  try {
    formatter = new Intl.RelativeTimeFormat(locale, {
      numeric: 'always',
      style: 'narrow',
    });
  } catch {
    // A malformed locale tag must degrade to English, never crash a row
    // (the hard rendering rule); negotiation only ever passes supported tags.
    formatter = new Intl.RelativeTimeFormat('en-US', {
      numeric: 'always',
      style: 'narrow',
    });
  }
  formatters.set(locale, formatter);
  return formatter;
}

/**
 * "5 min. ago" / "vor 5 Min." / "5 мин өмнө" — a fixed unit ladder
 * (minutes → hours → days, floor 1 minute) on the active locale.
 * Empty string for null/invalid input, matching the English helper.
 */
export function formatRelativeTime(value: string | null, locale: string): string {
  if (!value) return '';

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';

  const formatter = relativeFormatter(locale);
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 60) return formatter.format(-minutes, 'minute');

  const hours = Math.round(minutes / 60);
  if (hours < 24) return formatter.format(-hours, 'hour');

  return formatter.format(-Math.round(hours / 24), 'day');
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function shortDateFormatter(locale: string): Intl.DateTimeFormat {
  const cached = dateFormatters.get(locale);
  if (cached) return cached;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    // Same degradation contract as the relative formatter: a malformed locale
    // tag falls back to English rather than throwing inside a render.
    formatter = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
  dateFormatters.set(locale, formatter);
  return formatter;
}

/**
 * "Aug 1, 2026" / "1. Aug. 2026" — an absolute short date on the active locale,
 * for lists where "how old" matters less than "which day" (the version-switcher
 * overflow menu, #141). Empty string for null/invalid input.
 */
export function formatShortDate(value: string | null | undefined, locale: string): string {
  if (!value) return '';

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';

  return shortDateFormatter(locale).format(timestamp);
}
