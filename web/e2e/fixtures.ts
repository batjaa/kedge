// The deterministic fixture-document URLs the journey pack (#39) imports. One
// place so a spec and the fixture file it drives can never drift on host, port,
// or path — the same discipline fixture-doc.ts keeps for the single M1 URL.
//
// Every URL is on 127.0.0.1 (the fixture server, web/e2e/serve-fixtures.mjs): an
// IP literal keeps DNS out of the SSRF guard's path, and it is exactly the host
// web/e2e/serve-api.sh puts in the API's test-only FETCH_ALLOW_HOSTS — so the
// guard admits these fetches, and only these, in the E2E env. No spec ever
// touches a live external URL.

import { FIXTURE_HOST, FIXTURE_PORT } from './fixture-doc';

/** Base origin of the loopback fixture server. */
export const FIXTURE_ORIGIN = `http://${FIXTURE_HOST}:${FIXTURE_PORT}`;

/** Build a fixture URL from a path served by web/e2e/serve-fixtures.mjs. */
export function fixtureUrl(path: string): string {
  return `${FIXTURE_ORIGIN}/${path.replace(/^\/+/, '')}`;
}

/**
 * A dull plain-markdown document (one heading, prose, no diagrams/images) reused
 * by the import-url, share-lifecycle, and auth-edges journeys — so a failure
 * points at the surface under test, not the document. The title is synthesized
 * from the first heading; the body sentence is asserted verbatim.
 */
export const PLAIN_DOC = {
  url: fixtureUrl('rfc-100-url-import.md'),
  title: 'RFC-100: URL import round-trip',
  body: "the import round-trip preserves the document's prose exactly as written",
} as const;

/**
 * A document with a mermaid fence (→ cached SVG image) AND an unknown-language
 * fence (→ one contiguous plain code block, #53). Drives the diagrams journey.
 */
export const DIAGRAMS_DOC = {
  url: fixtureUrl('rfc-200-diagrams.md'),
  title: 'RFC-200: Diagram rendering surfaces',
  /** Distinctive text of the unknown fence — must land in exactly one <pre>. */
  plainFenceText: 'this-is-not-a-diagram',
  /** The mermaid source — must NOT fall through to a code block. */
  mermaidSource: 'flowchart LR',
} as const;

/**
 * A document whose mermaid fence is a deliberate parse error (an unknown diagram
 * type), so Kroki 400s and the diagram degrades to the never-crash source panel
 * WITH the renderer's own message shown beside the source (issue #56). Drives the
 * broken-diagram assertion in the diagrams journey.
 */
export const BROKEN_DIAGRAM_DOC = {
  url: fixtureUrl('rfc-201-broken-diagram.md'),
  title: 'RFC-201: Broken diagram surfaces the renderer error',
  /** Distinctive source text that must appear inside the show-source panel. */
  brokenSource: 'notarealdiagramtype',
  /** The panel's label for the renderer's message. */
  detailLabel: 'Renderer said:',
} as const;

/**
 * An HTML document referencing one image that re-hosts and one that 404s → the
 * doc renders ready with an amber import-warning panel. Drives import-warnings.
 */
export const WARNINGS_DOC = {
  url: fixtureUrl('report-warnings.html'),
  title: 'Import warnings report',
  brokenImageUrl: fixtureUrl('status/500'),
} as const;

/**
 * A hardened-MDX document: an allowlisted <Callout> (renders) and an unknown
 * <Fancy> component (→ neutral "Unsupported component" box). Drives mdx-safety.
 */
export const MDX_COMPONENTS_DOC = {
  url: fixtureUrl('mdx-components.mdx'),
  title: 'MDX component safety',
  unknownComponentName: 'Fancy',
} as const;

/**
 * A hardened-MDX document that smuggles an ES import (→ mdx_ok=false → plain
 * markdown fallback + banner) and embeds a <script> whose marker must appear
 * nowhere in the DOM. Drives the mdx-safety injection assertion.
 */
export const MDX_SMUGGLED_DOC = {
  url: fixtureUrl('mdx-smuggled.mdx'),
  title: 'Smuggled import falls back safely',
  /** Distinctive marker the injected <script> would leave — must stay absent. */
  xssMarker: 'XSSMARKER39',
} as const;

/**
 * The M4 AI/agent fixture (#137), imported by the mcp-agent, ai-triage, and
 * ai-split journeys. Every anchor below sits on ONE source line in the fixture
 * file: the rendered paragraph keeps the source's line breaks, and the
 * selection helper matches inside a single text node.
 */
export const AI_DOC = {
  url: fixtureUrl('rfc-300-ai-review.md'),
  title: 'RFC-300: The AI review loop',
  /** The passage the MCP agent anchors its comment to, straight from `plain_text`. */
  mcpAnchor: 'An agent reviewer reads this document over MCP and answers in the same rail as a person.',
  /** The passage the human author comments on, so the review has two voices in it. */
  authorAnchor: 'A digest counts every thread on this document and says so in one honest sentence.',
  /** The passage the ai-triage journey comments on. */
  triageAnchor: "A stance is the author's decision, and the model writes the reply they already chose.",
  /**
   * The passage the ai-split journey anchors its multi-issue comment to. The
   * scripted split proposals quote two disjoint spans of THIS sentence — see
   * `SPLIT_QUOTE_ONE`/`SPLIT_QUOTE_TWO` in
   * api/app/Providers/FakeAiServiceProvider.php, the other half of the contract.
   * A split's anchor is located inside the source thread's passage or not at
   * all, so the two must stay in step.
   */
  splitAnchor:
    'Two things matter here: the anchor must survive a re-import, and the digest is only ever a draft the author confirms.',
} as const;

/** A deterministic upstream 500 — the transient (non-2xx) import-failure source. */
export const UPSTREAM_500_URL = fixtureUrl('status/500');

/** A URL the SSRF guard always refuses: a private/reserved address, off the allowlist. */
export const PRIVATE_ADDRESS_URL = 'http://10.0.0.1/private-spec.md';
