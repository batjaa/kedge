import type { ReactElement } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { diagramSecret, fetchDiagramUrl } from '../lib/diagram-client';
import { resolveDiagram } from '../components/cached-kroki-diagram';
import { renderMarkdown } from '../lib/render-markdown';

// The web half of the API-mediated diagram cache (SPEC §6.2). The API is faked at
// the fetch boundary — these assert what the web SENDS (engine, source, secret)
// and RENDERS (a cached-SVG <img>, or the never-crash source panel), never a real
// Kroki or API socket.

function fakeFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    Promise.resolve(impl(String(input), (init ?? {}) as RequestInit)),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('diagramSecret', () => {
  it('falls back to the shared dev default when unset', () => {
    expect(diagramSecret({})).toBe('dev-diagram-secret');
  });

  it('uses DIAGRAM_SHARED_SECRET when set', () => {
    expect(diagramSecret({ DIAGRAM_SHARED_SECRET: 's3cr3t' })).toBe('s3cr3t');
  });
});

describe('fetchDiagramUrl', () => {
  it('posts engine + source with the secret header and returns the cached URL', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    fakeFetch((url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ url: '/storage/diagrams/mermaid/abc.svg' }), { status: 200 });
    });

    const result = await fetchDiagramUrl('mermaid', 'graph TD\nA-->B');

    expect(result).toEqual({ ok: true, url: '/storage/diagrams/mermaid/abc.svg' });
    expect(seen!.url).toContain('/api/internal/diagrams');
    expect(seen!.init.method).toBe('POST');
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers['x-diagram-secret']).toBe('dev-diagram-secret');
    expect(JSON.parse(String(seen!.init.body))).toEqual({ engine: 'mermaid', source: 'graph TD\nA-->B' });
  });

  it('reports ok:false on a non-200 (unsupported engine or Kroki failure)', async () => {
    fakeFetch(() => new Response(JSON.stringify({ error: 'render_failed' }), { status: 422 }));
    expect(await fetchDiagramUrl('mermaid', 'x')).toEqual({ ok: false });
  });

  it('reports ok:false when the API is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await fetchDiagramUrl('mermaid', 'x')).toEqual({ ok: false });
  });

  it('reports ok:false on a malformed body', async () => {
    fakeFetch(() => new Response(JSON.stringify({ nope: true }), { status: 200 }));
    expect(await fetchDiagramUrl('mermaid', 'x')).toEqual({ ok: false });
  });
});

describe('resolveDiagram (imported-doc component)', () => {
  it('renders a cached-SVG <img> on success — no Kroki, no script surface', async () => {
    fakeFetch(() => new Response(JSON.stringify({ url: '/storage/diagrams/mermaid/abc.svg' }), { status: 200 }));

    const html = renderToStaticMarkup(await resolveDiagram({ engine: 'mermaid', source: 'graph TD' }));

    expect(html).toContain('<img');
    expect(html).toContain('src="/storage/diagrams/mermaid/abc.svg"');
    expect(html).not.toContain('<script');
  });

  it('degrades to the show-source panel when the render fails', async () => {
    fakeFetch(() => new Response('nope', { status: 422 }));

    const html = renderToStaticMarkup(await resolveDiagram({ engine: 'plantuml', source: '@bad uml@' }));

    expect(html).toContain('render failed');
    expect(html).toContain('@bad uml@'); // the raw source is shown
    expect(html).not.toContain('<img');
  });
});

describe('markdown renderer wires diagram fences to the diagram component', () => {
  it('routes a diagram fence through the API-mediated component (engine prop flows end to end)', async () => {
    fakeFetch(() => new Response(JSON.stringify({ url: '/storage/diagrams/mermaid/xyz.svg' }), { status: 200 }));

    const node = (await renderMarkdown('```mermaid\ngraph TD\nA-->B\n```')) as ReactElement;
    // renderToStaticMarkup emits the Suspense fallback for the still-pending
    // diagram. The skeleton prints the engine — so its presence proves the fence
    // was recognised as a diagram AND that engine='mermaid' flowed through the
    // hast → component prop mapping (not rendered as a <pre> code block).
    const html = renderToStaticMarkup(node);
    expect(html).not.toContain('<pre');
    expect(html).toContain('rendering mermaid');
  });

  it('leaves an unknown fence language as plain code — never a diagram, never Kroki', async () => {
    const fetchSpy = fakeFetch(() => new Response('{}', { status: 200 }));

    const node = (await renderMarkdown('```qwerty\nnot a real language\n```')) as ReactElement;
    const html = renderToStaticMarkup(node);

    expect(html).toContain('<pre');
    expect(html).toContain('not a real language');
    expect(fetchSpy).not.toHaveBeenCalled(); // unknown fence never reaches the API
  });
});
