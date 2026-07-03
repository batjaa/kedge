import { deflateSync } from 'node:zlib';

// Kroki is the sole diagram engine (SPEC §6.2): server-side render, cached by
// Next's fetch cache, SVG embedded via <img data:> — readers execute no
// diagram code and never talk to Kroki directly. KROKI_URL points at the
// self-hosted container (bundled in the compose file; the SaaS runs its own
// from M1, so private diagram source never reaches a third party).
// Product-grade version adds R2-backed caching keyed by source hash (§6.2).

const KROKI_URL = process.env.KROKI_URL ?? 'https://kroki.io';

export async function KrokiDiagram({ engine, source }: { engine: string; source: string }) {
  try {
    const encoded = Buffer.from(deflateSync(source, { level: 9 })).toString('base64url');
    const res = await fetch(`${KROKI_URL}/${engine}/svg/${encoded}`, {
      cache: 'force-cache',
    });
    if (!res.ok) throw new Error(`Kroki responded ${res.status}`);
    const svg = await res.text();

    return (
      <figure className="not-prose my-6 overflow-hidden rounded-2xl ring-1 ring-zinc-900/10 dark:ring-white/10">
        {/* Diagrams render on a light surface in both themes for legibility */}
        <div className="overflow-x-auto bg-white p-4">
          <img
            className="mx-auto max-w-full"
            alt={`${engine} diagram`}
            src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
          />
        </div>
        <figcaption className="border-t border-zinc-900/5 px-4 py-1.5 font-mono text-[10px] uppercase text-zinc-400 dark:border-white/5 dark:text-zinc-500">
          {engine} · rendered via kroki
        </figcaption>
      </figure>
    );
  } catch {
    // DESIGN.md failure rule: never crash — show the raw source instead
    return (
      <div className="not-prose my-6 rounded-2xl bg-rose-400/5 p-4 ring-1 ring-inset ring-rose-500/20">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase text-rose-600 dark:text-rose-400">
          {engine} — render failed, showing source
        </p>
        <pre className="overflow-x-auto font-mono text-xs text-zinc-600 dark:text-zinc-400">{source}</pre>
      </div>
    );
  }
}
