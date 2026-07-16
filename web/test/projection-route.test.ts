import { describe, it, expect } from 'vitest';
import { POST } from '../app/internal/projection/route';
import { componentToken } from '../lib/projection';

// The internal projection endpoint's mdx_ok contract (SPEC §5.4 / §6.1). The API
// import job POSTs normalized content + format here; the response's mdx_ok is
// what the API stores and the doc page reads to choose MDX vs. fallback. Only
// `mdx` content is compiled — `md` always parses — so mdx_ok gates by format.
const SECRET = 'dev-projection-secret'; // the dev default (NODE_ENV !== production)

function post(body: unknown): Request {
  return new Request('http://localhost/internal/projection', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-projection-secret': SECRET },
    body: JSON.stringify(body),
  });
}

async function call(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  // The route only reads .json() and header — a plain Request satisfies it.
  const res = await POST(post(body) as never);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('projection endpoint mdx_ok (SPEC §5.4)', () => {
  it('reports mdx_ok=false for uncompilable MDX', async () => {
    const { status, json } = await call({ content: "import x from 'y'\n\n# Doc", format: 'mdx' });
    expect(status).toBe(200);
    expect(json.mdx_ok).toBe(false);
    // Projection still produces the substrate (the import line as inert text).
    expect(json.plain_text).toContain('Doc');
  });

  it('reports mdx_ok=true for valid MDX', async () => {
    const { json } = await call({ content: '<Callout>ok</Callout>\n\n# Doc', format: 'mdx' });
    expect(json.mdx_ok).toBe(true);
  });

  it('projects valid MDX components as atomic placeholder tokens', async () => {
    const { json } = await call({ content: '<Callout>ok</Callout>\n\n# Doc', format: 'mdx' });
    expect(json.plain_text).toBe(`${componentToken('Callout')}\n\nDoc`);
  });

  it('reports mdx_ok=true for markdown regardless of MDX-looking text', async () => {
    // Same hostile bytes, but format=md → not compiled, always projects.
    const { json } = await call({ content: "import x from 'y'\n\n# Doc", format: 'md' });
    expect(json.mdx_ok).toBe(true);
  });

  it('rejects an unauthenticated caller with 404', async () => {
    const res = await POST(
      new Request('http://localhost/internal/projection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '# x', format: 'md' }),
      }) as never,
    );
    expect(res.status).toBe(404);
  });
});
