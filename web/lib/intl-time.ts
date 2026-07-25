// Locale-aware time formatting for the app chrome (M3.9 #123): the compact
// relative-time idiom the rows and the activity feed use, rendered through
// Intl.RelativeTimeFormat on the ACTIVE locale — never hand-built suffixes, so
// CLDR owns the wording for es/de/mn. Deliberate sibling of lib/relative-time.ts,
// which stays the locale-blind English helper the review surface still consumes
// (#126 migrates it here); unit thresholds mirror it exactly so the two never
// disagree about "how old" a timestamp reads.

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
 * "5 min. ago" / "vor 5 Min." / "5 мин өмнө" — relativeTime()'s exact unit
 * ladder (minutes → hours → days, floor 1 minute) on the active locale.
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
