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
 * escaped by Blade (`&amp;`) and can be quoted-printable encoded/wrapped
 * (`=3D`, `=\n`, `=XX`). Decode in that order before extracting the URL so the
 * signed route's query string stays byte-for-byte intact.
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
  const withoutSoftBreaks = removeSoftBreaks(value);
  const protectedQueryEquals = withoutSoftBreaks.replace(
    /([?&][A-Za-z0-9_.~-]+)=((?!3[Dd])[0-9A-Fa-f]{2})/g,
    '$1__KEDGE_QUERY_EQUALS__$2',
  );

  return protectedQueryEquals
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => {
      return String.fromCharCode(Number.parseInt(hex, 16));
    })
    .replace(/__KEDGE_QUERY_EQUALS__/g, '=');
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
