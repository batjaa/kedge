import { describe, expect, it } from 'vitest';
import { POST } from '../app/internal/reanchor/route';

const SECRET = 'dev-projection-secret';

function post(body: unknown, secret: string | null = SECRET): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['x-projection-secret'] = secret;

  return new Request('http://localhost/internal/reanchor', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function call(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await POST(post(body) as never);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('reanchor endpoint', () => {
  it('rejects an unauthenticated caller with 404', async () => {
    const res = await POST(post({ anchors: [], newPlainText: '' }, null) as never);
    expect(res.status).toBe(404);
  });

  it('rejects malformed bodies with 400', async () => {
    const { status } = await call({ anchors: [{ threadId: 1 }], newPlainText: 'Text' });
    expect(status).toBe(400);
  });

  it('rejects oversized batches with 400', async () => {
    const anchor = { threadId: 1, exact: 'x', prefix: null, suffix: null, start: 0, end: 1 };
    const { status, json } = await call({
      newPlainText: 'x',
      anchors: Array.from({ length: 5001 }, (_, index) => ({ ...anchor, threadId: index + 1 })),
    });

    expect(status).toBe(400);
    expect(json.error).toBe('too many anchors');
  });

  it('returns exact-tier results', async () => {
    const { status, json } = await call({
      newPlainText: 'Alpha beta gamma.',
      anchors: [{ threadId: 1, exact: 'beta', prefix: 'Alpha ', suffix: ' gamma.', start: 6, end: 10 }],
    });

    expect(status).toBe(200);
    expect(json.results).toEqual([
      { threadId: 1, state: 'anchored', exact: 'beta', prefix: 'Alpha ', suffix: ' gamma.', start: 6, end: 10 },
    ]);
  });
});
