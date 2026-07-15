import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, PROJECTION_SECRET_HEADER } from '@/lib/projection-auth';
import { project } from '@/lib/projection';
import { validateMdx } from '@/lib/mdx';

// Internal projection service (SPEC §5.4). The API's import job POSTs normalized
// content here and stores the returned plain_text + projection_version on the
// version — the anchor substrate M2 stands on. It walks the same remark pipeline
// that renders (lib/pipeline.ts), so there is exactly one definition of what a
// document is.
//
// Node runtime: the projection uses the unified/remark toolchain. Dynamic: never
// cached — each import must project its own content.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request.headers.get(PROJECTION_SECRET_HEADER))) {
    // 404, not 401/403: an unauthenticated caller never learns the endpoint
    // exists. The shared secret (not proxy placement) is the guard (§5.4).
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const content = (body as { content?: unknown } | null)?.content;
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
  }

  // Format decides whether mdx_ok is a real gate. Only `mdx` content is compiled
  // and validated; `md`/`html` always parse, so mdx_ok stays true (SPEC §5.2).
  const format = (body as { format?: unknown } | null)?.format;

  try {
    const { plainText, projectionVersion, warnings } = project(content);

    // The same hardened compile the page renders through is the MDX validator:
    // a rejected construct or a syntax error is mdx_ok=false, which the API
    // stores and the doc page reads to render the plain-markdown fallback (SPEC
    // §6.1) — without the page ever recompiling to find out.
    let mdxOk = true;
    const allWarnings = [...warnings];
    if (format === 'mdx') {
      const validation = await validateMdx(content);
      mdxOk = validation.ok;
      allWarnings.push(...validation.warnings);
    }

    return NextResponse.json({
      plain_text: plainText,
      projection_version: projectionVersion,
      mdx_ok: mdxOk,
      warnings: allWarnings,
    });
  } catch {
    // A projection failure is a transient import failure — the API retries — never
    // a silently-unprojected version (§5.4). Return 500 so the job backs off.
    return NextResponse.json({ error: 'projection failed' }, { status: 500 });
  }
}
