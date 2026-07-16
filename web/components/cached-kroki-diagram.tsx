import { Suspense } from 'react';
import type { ReactElement } from 'react';
import { fetchDiagramUrl } from '@/lib/diagram-client';
import { DiagramFigure } from '@/components/diagram-figure';
import { DiagramSkeleton, DiagramSourceError } from '@/components/diagram-states';

// The diagram component for IMPORTED documents (SPEC §6.2). Bound to the JSX name
// `KrokiDiagram` in the imported-MDX allowlist and to `kroki-diagram` in the
// markdown renderer, so every imported surface — hardened MDX and the plain /
// fallback markdown path — renders diagrams through the ONE API-mediated cache.
//
// Server render asks the API for the cached-SVG URL (rendering + caching it on a
// miss); the reader's browser receives a static <img> at /storage and never
// contacts Kroki. A failure degrades to the show-source panel — the page never
// crashes (hard rule #2). The dogfood /docs surface keeps its own build-time
// component (components/kroki-diagram) because it renders at build, where the API
// isn't up; both share the DiagramFigure presentation and click-to-zoom.

type ProjectionAttrs = { [key: `data-${string}`]: string | undefined };

/**
 * Resolve one diagram to its rendered node. Exported for the fixture suite so a
 * diagram can be tested without a Suspense/streaming renderer: await it, then
 * assert the resulting <img> (success) or source panel (failure).
 */
export async function resolveDiagram({
  engine,
  source,
  projectionAttrs = {},
}: {
  engine: string;
  source: string;
  projectionAttrs?: ProjectionAttrs;
}): Promise<ReactElement> {
  const result = await fetchDiagramUrl(engine, source);
  if (!result.ok || !result.url) {
    return (
      <DiagramSourceError
        engine={engine}
        source={source}
        errorDetail={result.errorDetail}
        {...projectionAttrs}
      />
    );
  }
  return <DiagramFigure engine={engine} src={result.url} {...projectionAttrs} />;
}

/**
 * `<KrokiDiagram engine source/>` for imported docs. The async resolution is
 * wrapped in a Suspense boundary so each diagram streams its own loading skeleton
 * while the API round-trip is in flight, rather than blocking the whole document.
 */
export function CachedKrokiDiagram({
  engine,
  source,
  ...projectionAttrs
}: { engine: string; source: string } & ProjectionAttrs) {
  return (
    <Suspense fallback={<DiagramSkeleton engine={engine} {...projectionAttrs} />}>
      {resolveDiagram({ engine, source, projectionAttrs })}
    </Suspense>
  );
}
