import { deflateSync } from 'node:zlib';
import { DiagramFigure } from '@/components/diagram-figure';
import { DiagramSourceError } from '@/components/diagram-states';
import { sanitizeDiagramDetail } from '@/lib/diagram-detail';

// The diagram component for the DOGFOOD /docs surface (SPEC §6.2). Distinct from
// the imported-doc path (components/cached-kroki-diagram) on purpose: /docs is
// statically generated at BUILD time, where the API isn't running, so it can't
// use the API-mediated cache. It renders directly against Kroki at build and
// inlines the SVG as a data: URL — readers still never contact Kroki (the SVG is
// baked into the static HTML), just as SPEC §6.2 requires.
//
// Presentation and click-to-zoom are shared with the imported path via
// DiagramFigure / DiagramSourceError, so both surfaces look and behave the same;
// only where the SVG comes from differs (build-time Kroki here, request-time API
// cache there). KROKI_URL is env-driven; hosted kroki.io is acceptable in local
// dev only. The imported surface is where the shared, persistent hash cache lives
// (the spike found Next's fetch cache is per-build, not shared).

const KROKI_URL = process.env.KROKI_URL ?? 'https://kroki.io';

export async function KrokiDiagram({ engine, source }: { engine: string; source: string }) {
  try {
    const encoded = Buffer.from(deflateSync(source, { level: 9 })).toString('base64url');
    const res = await fetch(`${KROKI_URL}/${engine}/svg/${encoded}`, {
      cache: 'force-cache',
    });
    if (!res.ok) {
      // A bad-source diagram: Kroki 4xx's with a plaintext reason. This path
      // renders directly against Kroki (build time), so we sanitize its body
      // here — the untrusted-text discipline the API applies for imported docs
      // (issue #56) — and surface it beside the source. A failure reading the
      // body just leaves the detail absent; the panel still renders.
      const detail = await readKrokiDetail(res);
      return <DiagramSourceError engine={engine} source={source} errorDetail={detail} />;
    }
    const svg = await res.text();

    return <DiagramFigure engine={engine} src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />;
  } catch {
    // Never crash on a Kroki hiccup — show the raw source instead (hard rule #2).
    return <DiagramSourceError engine={engine} source={source} />;
  }
}

/** Read + sanitize Kroki's error body, never throwing (falls back to no detail). */
async function readKrokiDetail(res: Response): Promise<string | undefined> {
  try {
    return sanitizeDiagramDetail(await res.text());
  } catch {
    return undefined;
  }
}
