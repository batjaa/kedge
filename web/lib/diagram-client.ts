import { apiBaseUrl } from './config';

// Server-only client for the API's internal diagram-render endpoint (SPEC §6.2).
// The mirror of lib/projection-auth with the roles swapped: for projection the
// API calls the web; for diagrams the web calls the API. The API mediates Kroki
// — it renders each diagram once per (engine, source_hash), caches the SVG on the
// media disk, and returns the cached /storage URL — so the reader's browser
// embeds a static <img> and NEVER contacts Kroki or executes diagram code.
//
// The endpoint is internal (never publicly reachable in the SaaS topology) and
// shared-secret guarded; this client presents the secret on every call. Any
// failure is reported as { ok: false } so the diagram component degrades to its
// never-crash show-source panel rather than throwing.

const DEV_SECRET = 'dev-diagram-secret';
const HEADER = 'x-diagram-secret';

/**
 * The secret the render endpoint requires. Mirrors the API's
 * `kedge.diagram.secret`: dev falls back to a well-known value the API also
 * defaults to (so `npm run dev` renders diagrams with no config); production sets
 * DIAGRAM_SHARED_SECRET to the same value on both sides.
 */
export function diagramSecret(env: Record<string, string | undefined> = process.env): string {
  const configured = env.DIAGRAM_SHARED_SECRET;
  return configured && configured.length > 0 ? configured : DEV_SECRET;
}

export interface DiagramRenderResult {
  /** True with a `url` on success; false whenever the diagram must show its source. */
  ok: boolean;
  /** The cached SVG's public /storage URL (present iff ok). */
  url?: string;
}

/**
 * Resolve the cached-SVG URL for one diagram, asking the API to render + cache it
 * on a miss. Never throws: an unreachable API, a non-200 (unsupported engine or a
 * Kroki render failure), or a malformed body all become { ok: false }.
 */
export async function fetchDiagramUrl(engine: string, source: string): Promise<DiagramRenderResult> {
  try {
    const res = await fetch(`${apiBaseUrl}/api/internal/diagrams`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        [HEADER]: diagramSecret(),
      },
      body: JSON.stringify({ engine, source }),
      // The API owns the persistent, shared cache (the point of this ticket); the
      // web must not layer a per-build Next fetch cache over it, so never store.
      cache: 'no-store',
    });

    if (res.status !== 200) return { ok: false };

    const data = (await res.json()) as { url?: unknown };
    return typeof data.url === 'string' ? { ok: true, url: data.url } : { ok: false };
  } catch {
    return { ok: false };
  }
}
