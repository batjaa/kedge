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

function extractLatestMagicLinkUrl(raw: string, normalizedEmail: string): string | null {
  for (const decoded of decodedLogMailerBodies(raw)) {
    const matchingWindow = latestWindowForEmail(decoded, normalizedEmail);
    const matches = [...matchingWindow.matchAll(VERIFY_LINK_PATTERN)]
      .map((match) => normalizeExtractedUrl(match[0]))
      .filter(isCompleteMagicLinkUrl);
    const match = matches.at(-1);
    if (match) return match;
  }

  return null;
}

function decodedLogMailerBodies(raw: string): string[] {
  const withoutSoftBreaks = removeSoftBreaks(raw);

  return [
    decodeHtmlEntities(withoutSoftBreaks),
    decodeHtmlEntities(decodeQuotedPrintable(raw)),
  ];
}

function latestWindowForEmail(decoded: string, normalizedEmail: string): string {
  const lower = decoded.toLowerCase();
  const index = lower.lastIndexOf(normalizedEmail);
  if (index === -1) return '';

  const start = Math.max(0, index - 12_000);
  const end = Math.min(decoded.length, index + 24_000);

  return decoded.slice(start, end);
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
