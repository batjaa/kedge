import { deflateSync } from 'node:zlib';

// PlantUML rendering per SPEC §6.2: server-side via Kroki (deflate+base64url
// GET), cached by Next's fetch cache so readers never hit Kroki directly.
// KROKI_URL switches to a self-hosted container for private mode.
// The SVG is embedded via <img data:> — no script execution surface.
// Product-grade version adds R2-backed caching keyed by source hash (§6.2).

const KROKI_URL = process.env.KROKI_URL ?? 'https://kroki.io';

export async function PlantUML({ source }: { source: string }) {
  try {
    const encoded = Buffer.from(deflateSync(source, { level: 9 })).toString('base64url');
    const res = await fetch(`${KROKI_URL}/plantuml/svg/${encoded}`, {
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
            alt="PlantUML diagram"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
          />
        </div>
        <figcaption className="border-t border-zinc-900/5 px-4 py-1.5 font-mono text-[10px] uppercase text-zinc-400 dark:border-white/5 dark:text-zinc-500">
          plantuml · rendered via kroki
        </figcaption>
      </figure>
    );
  } catch {
    // DESIGN.md failure rule: never crash — show the raw source instead
    return (
      <div className="not-prose my-6 rounded-2xl bg-rose-400/5 p-4 ring-1 ring-inset ring-rose-500/20">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase text-rose-600 dark:text-rose-400">
          plantuml — render failed, showing source
        </p>
        <pre className="overflow-x-auto font-mono text-xs text-zinc-600 dark:text-zinc-400">{source}</pre>
      </div>
    );
  }
}
