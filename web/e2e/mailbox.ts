import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';

const DEFAULT_MAIL_LOG_PATH = resolve(process.cwd(), '../api/storage/logs/laravel.log');
const VERIFY_LINK_PATTERN = /https?:\/\/[^\s"'<>]+\/api\/v1\/shared\/[A-Za-z0-9_-]+\/verify\/[^\s"'<>]+/g;

export interface MagicLinkLookupOptions {
  email: string;
  logPath?: string;
  timeoutMs?: number;
}

/**
 * Poll Laravel's log mailer output for the newest reviewer magic-link URL.
 *
 * The log transport writes a MIME email, not a clean URL list. The href is HTML
 * escaped by Blade (`&amp;`) and can be quoted-printable soft-wrapped (`=\r?\n`)
 * on long lines. Undo the soft wrap and the entities before extracting the URL
 * so the signed route's query string stays byte-for-byte intact — deliberately
 * NOT doing a general `=XX`→byte decode (see decodeQuotedPrintable).
 */
export async function latestReviewerMagicLinkUrl({
  email,
  logPath = DEFAULT_MAIL_LOG_PATH,
  timeoutMs = 15_000,
}: MagicLinkLookupOptions): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  await expect
    .poll(
      async () => {
        const raw = await readFile(logPath, 'utf8').catch(() => '');
        return extractLatestMagicLinkUrl(raw, normalizedEmail);
      },
      {
        timeout: timeoutMs,
        message: `waiting for reviewer magic link for ${email} in ${logPath}`,
      },
    )
    .not.toBeNull();

  const raw = await readFile(logPath, 'utf8');
  const url = extractLatestMagicLinkUrl(raw, normalizedEmail);
  if (!url) {
    throw new Error(`Reviewer magic link for ${email} disappeared from ${logPath}`);
  }

  return url;
}

export function decodeLogMailerBody(raw: string): string {
  return decodedLogMailerBodies(raw).at(-1) ?? '';
}

/**
 * The extraction rule, exposed for the unit test that pins its parallel-safety
 * (test/mailbox.test.ts). The polling wrapper above needs a real log file and a
 * clock; the rule that decides WHICH message is yours needs neither.
 */
export function extractMagicLinkForTest(raw: string, email: string): string | null {
  return extractLatestMagicLinkUrl(raw, email.trim().toLowerCase());
}

/**
 * The newest link ADDRESSED TO this reviewer — matched per log entry, never by
 * proximity.
 *
 * This used to take a ±character window around the last occurrence of the
 * address and return the last link inside it, which is correct only while the
 * pack runs serially. Four specs send reviewer magic links to this one shared
 * log (i18n-shared, i18n-review, reviewer-magic-link, suggestion), and one
 * message runs to a couple of hundred lines — so once the pack went parallel
 * (#148) the forward half of that window routinely reached into the NEXT
 * reviewer's message, and `.at(-1)` handed back their link. Verification then
 * ran for the wrong reviewer and the journey failed on a redirect that never
 * carried `?verified=1`.
 *
 * The log mailer writes one MIME message per log entry, so an entry is the
 * natural unit: split on entry boundaries, keep the entries whose `To:` header
 * is this reviewer, and read the link out of the newest of those. Proximity
 * never enters into it.
 */
function extractLatestMagicLinkUrl(raw: string, normalizedEmail: string): string | null {
  const entries = logEntries(raw);

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    for (const decoded of decodedLogMailerBodies(entries[index])) {
      if (!isAddressedTo(decoded, normalizedEmail)) continue;

      const matches = [...decoded.matchAll(VERIFY_LINK_PATTERN)]
        .map((match) => normalizeExtractedUrl(match[0]))
        .filter(isCompleteMagicLinkUrl);
      const match = matches.at(-1);
      if (match) return match;
    }
  }

  return null;
}

/**
 * Split the log into its entries. Every line Laravel writes starts with a
 * `[YYYY-MM-DD HH:MM:SS]` stamp; a mailed message is one such entry whose
 * payload runs over many unstamped lines until the next one.
 */
export function logEntries(raw: string): string[] {
  return raw
    .split(/^(?=\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})/m)
    .filter((entry) => entry.trim() !== '');
}

/**
 * Whether this message was SENT TO the reviewer, read from the `To:` header
 * rather than from the text anywhere in the entry — an address can legitimately
 * appear in a body (journey comments embed the author's email verbatim), and
 * matching that would reintroduce exactly the cross-talk this replaced.
 */
function isAddressedTo(decoded: string, normalizedEmail: string): boolean {
  return (decoded.match(/^to:.*$/gim) ?? []).some(
    (header) => header.toLowerCase().includes(normalizedEmail),
  );
}

function decodedLogMailerBodies(raw: string): string[] {
  const withoutSoftBreaks = removeSoftBreaks(raw);

  return [
    decodeHtmlEntities(withoutSoftBreaks),
    decodeHtmlEntities(decodeQuotedPrintable(raw)),
  ];
}

function normalizeExtractedUrl(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/=\r?\n/g, '')
    .trim();
}

function decodeQuotedPrintable(value: string): string {
  // The log-driver mail writes the magic-link URL with LITERAL `=` separators
  // (`expires=…&signature=…`), HTML-entity ampersands (`&amp;`), and possible
  // quoted-printable SOFT breaks on long lines (`=\r?\n`) — but never `=XX`
  // byte escapes (signed-URL values are all printable ASCII, so nothing gets
  // QP-encoded). So the only QP artifact to undo is the soft break. We must NOT
  // run a general `=XX`→byte decode here: a signature that legitimately begins
  // with the hex digits `3d` would have its `=3d` eaten as an escaped `=`,
  // corrupting ~1/256 of links (a latent flake in the magic-link journey).
  return removeSoftBreaks(value);
}

function removeSoftBreaks(value: string): string {
  return value.replace(/=\r?\n/g, '');
}

function isCompleteMagicLinkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.searchParams.has('expires') && url.searchParams.has('signature');
  } catch {
    return false;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9A-Fa-f]+);/g, (_match, hex: string) => {
      return String.fromCodePoint(Number.parseInt(hex, 16));
    })
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      return String.fromCodePoint(Number.parseInt(decimal, 10));
    });
}
