import type { DocumentSource } from '@/lib/document-types';

// The provenance chip on every document row (M3.10 #117, SPEC §11): where a doc
// came from, rendered from the server-derived `source` descriptor — the web
// renders, never re-parses a blob URL (§5.4). DESIGN.md chip idiom: mono, neutral
// zinc tint. Provenance is METADATA, not status, so it borrows no status hue and
// adds no token.
//
// The value is left-truncated so a long path keeps its filename/basename visible
// (`…rfcs/017-anchoring.md`): a `direction: rtl` container clips the overflow at
// the left edge, and a leading LEFT-TO-RIGHT MARK (U+200E) keeps the Latin path in
// normal reading order regardless of a digit- or slash-leading segment. The DOM
// text is never truncated — only its rendering — so assistive tech reads the whole
// value; a `title` gives sighted users the full value on hover; an `sr-only`
// "Source:" prefix names what the value is (perceivable without vision, story 8).
export function SourceChip({ source }: { source: DocumentSource | null | undefined }) {
  // Defensive: a row must never crash the list on a missing/odd descriptor
  // (the hard rendering rule). No source → no chip.
  if (!source) return null;

  const rendered = renderSource(source);
  if (rendered === null) return null;

  const { text, truncate } = rendered;

  return (
    <span className="inline-flex min-w-0 items-center rounded-lg bg-zinc-400/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-400/30 dark:text-zinc-400">
      <span className="sr-only">Source: </span>
      {truncate ? (
        <span
          dir="rtl"
          title={text}
          className="inline-block max-w-[7rem] truncate text-left align-bottom sm:max-w-[12rem]"
        >
          {LRM + text}
        </span>
      ) : (
        <span>{text}</span>
      )}
    </span>
  );
}

/** U+200E LEFT-TO-RIGHT MARK — anchors the rtl-truncated path in reading order. */
const LRM = '\u200E';

/**
 * The chip's rendered value per kind (SPEC §11): `path` · `repo · path` · `host`
 * · "pasted". `truncate` marks the long, left-truncatable values (paths); short
 * ones (host, "pasted") render whole. Returns null only for a degenerate URL with
 * no host — the row simply carries no chip rather than an empty one.
 */
function renderSource(source: DocumentSource): { text: string; truncate: boolean } | null {
  switch (source.kind) {
    case 'repo':
      return source.path ? { text: source.path, truncate: true } : null;
    case 'github':
      if (!source.repo) return null;
      return {
        text: source.path ? `${source.repo} · ${source.path}` : source.repo,
        truncate: true,
      };
    case 'url':
      return source.host ? { text: source.host, truncate: false } : null;
    case 'upload':
      return { text: 'pasted', truncate: false };
    default:
      return null;
  }
}
