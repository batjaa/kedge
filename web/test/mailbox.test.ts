import { describe, expect, it } from 'vitest';
import { extractMagicLinkForTest, logEntries } from '@/e2e/mailbox';

// The reviewer magic-link mailbox helper, under PARALLEL conditions (#151
// branch gate).
//
// Four journeys send reviewer magic links into the same Laravel log —
// i18n-shared, i18n-review, reviewer-magic-link and suggestion — and one MIME
// message runs to a couple of hundred lines. While the pack ran serially that
// was harmless: nothing newer than your own message existed yet when you read
// the log. Since #148 put the pack on four workers, another reviewer's message
// routinely lands between yours and your read, and the old proximity window
// (±characters around the address, take the LAST link inside it) handed back
// THEIR link. The journey then verified the wrong reviewer and timed out on a
// redirect that never carried `?verified=1`.
//
// These fixtures are that interleaving, written down.

const BASE = 'http://localhost:8000/api/v1/shared';

function mailEntry(stamp: string, to: string, token: string, signature: string): string {
  return [
    `[2026-08-25 ${stamp}] e2e.DEBUG: Message-ID: <${signature}@example.com>`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    `To: ${to}`,
    'Subject: Review link for RFC-100: URL import round-trip',
    '',
    '<p>Continue reviewing:</p>',
    `<a href="${BASE}/${token}/verify/abc?expires=1800000000&amp;signature=${signature}">Open</a>`,
    '<p>This link expires in 30 minutes.</p>',
    '',
  ].join('\n');
}

const MINE = 'i18n-shared-reviewer-abc-1@kedge.test';
const THEIRS = 'reviewer-magic-reviewer-xyz-9@kedge.test';

describe('logEntries', () => {
  it('splits the log on entry stamps, keeping each message whole', () => {
    const raw = [
      '[2026-08-25 16:36:48] e2e.INFO: import.started {"document_id":1}',
      mailEntry('16:36:50', MINE, 'tokenmine', 'sigmine'),
      '[2026-08-25 16:36:52] e2e.INFO: import.completed {"document_id":1}',
    ].join('\n');

    const entries = logEntries(raw);

    expect(entries).toHaveLength(3);
    expect(entries[1]).toContain(`To: ${MINE}`);
    expect(entries[1]).toContain('sigmine');
  });
});

describe('extractMagicLinkForTest', () => {
  it('finds the reviewer&apos;s own link', () => {
    const raw = mailEntry('16:36:50', MINE, 'tokenmine', 'sigmine');

    expect(extractMagicLinkForTest(raw, MINE)).toContain('tokenmine');
  });

  it('never returns a link from a message addressed to someone else', () => {
    // The regression. Under four workers another reviewer's mail lands after
    // yours and before your read; the old window reached forward into it and
    // `.at(-1)` returned their link.
    const raw = [
      mailEntry('16:36:50', MINE, 'tokenmine', 'sigmine'),
      mailEntry('16:36:51', THEIRS, 'tokentheirs', 'sigtheirs'),
    ].join('\n');

    const url = extractMagicLinkForTest(raw, MINE);

    expect(url).toContain('tokenmine');
    expect(url).not.toContain('tokentheirs');
  });

  it('is unaffected by how many other reviewers are mailed around it', () => {
    const raw = [
      mailEntry('16:36:48', THEIRS, 'before-a', 'sigbeforea'),
      mailEntry('16:36:49', 'suggestion-reviewer-q-3@kedge.test', 'before-b', 'sigbeforeb'),
      mailEntry('16:36:50', MINE, 'tokenmine', 'sigmine'),
      mailEntry('16:36:51', THEIRS, 'after-a', 'sigaftera'),
      mailEntry('16:36:52', 'i18n-review-reviewer-z-7@kedge.test', 'after-b', 'sigafterb'),
    ].join('\n');

    expect(extractMagicLinkForTest(raw, MINE)).toContain('tokenmine');
  });

  it('returns the NEWEST of the reviewer&apos;s own links', () => {
    // A journey that requests a second link must not verify with the first.
    const raw = [
      mailEntry('16:36:50', MINE, 'older', 'sigolder'),
      mailEntry('16:36:55', MINE, 'newer', 'signewer'),
    ].join('\n');

    expect(extractMagicLinkForTest(raw, MINE)).toContain('newer');
  });

  it('ignores the address appearing in a BODY rather than a To: header', () => {
    // Journey comments embed the author's own email verbatim, so an address in
    // a body says nothing about who the message was sent to.
    const theirs = mailEntry('16:36:51', THEIRS, 'tokentheirs', 'sigtheirs')
      .replace('<p>Continue reviewing:</p>', `<p>Mentioned by ${MINE}</p>`);

    expect(extractMagicLinkForTest(theirs, MINE)).toBeNull();
  });

  it('returns null when the reviewer has no mail yet', () => {
    expect(extractMagicLinkForTest('', MINE)).toBeNull();
    expect(extractMagicLinkForTest(mailEntry('16:36:51', THEIRS, 't', 's'), MINE)).toBeNull();
  });

  it('survives quoted-printable soft breaks and HTML-escaped ampersands', () => {
    // The log driver soft-wraps long lines and Blade escapes the `&`; the
    // signed URL must come back byte-for-byte or the signature check fails.
    const raw = mailEntry('16:36:50', MINE, 'tokenmine', 'sigmine')
      .replace('&amp;signature=', '&amp;signat=\r\nure=');

    const url = extractMagicLinkForTest(raw, MINE);

    expect(url).toContain('&signature=sigmine');
    expect(url).not.toContain('&amp;');
  });
});
