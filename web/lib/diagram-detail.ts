// The renderer error-detail surfaced beside a failed diagram's source (issue
// #56). Kroki processes UNTRUSTED diagram source, so its error body is untrusted
// too — this reduces it to a short, single-line, plain-text detail safe to show.
// The API applies the identical rules server-side (DiagramRenderer::sanitizeDetail)
// for the imported path; the dogfood /docs path talks to Kroki directly at build
// time, so it sanitizes here. React escapes the result on render, so this is
// about legibility and length, not XSS.

/** Max characters ever surfaced. Mirrors the API's MAX_DETAIL_CHARS. */
export const MAX_DETAIL_CHARS = 500;

/**
 * Collapse all whitespace to single spaces, strip any remaining control
 * characters (C0 controls and DEL), and hard-truncate. Returns `undefined` for
 * input that sanitizes to nothing, so an empty detail never renders an empty
 * label.
 */
export function sanitizeDiagramDetail(raw: string): string | undefined {
  const collapsed = raw.replace(/\s+/g, ' ');

  let stripped = '';
  for (const ch of collapsed) {
    const code = ch.codePointAt(0) ?? 0;
    // Whitespace is already single spaces (0x20); drop the remaining C0 controls
    // and DEL, keep every printable character (ASCII and multibyte alike).
    if (code >= 0x20 && code !== 0x7f) stripped += ch;
  }

  const detail = stripped.trim().slice(0, MAX_DETAIL_CHARS);

  return detail.length > 0 ? detail : undefined;
}
