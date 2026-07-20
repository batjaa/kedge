import { NextRequest, NextResponse } from 'next/server';
import { isReanchorAuthorized, REANCHOR_SECRET_HEADER } from '@/lib/reanchor-auth';
import { reanchorExact, type ReanchorInputAnchor, type ReanchorResult } from '@/lib/reanchor-core';

// Internal re-anchor service (SPEC §8.3). The API's resync job POSTs outgoing
// version anchors and the target version's projection here; web owns the matcher
// because it already owns projection/capture offsets. M3 #76 ships exact only.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ANCHORS = 5000;
const CHUNK_SIZE = 100;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isReanchorAuthorized(request.headers.get(REANCHOR_SECRET_HEADER))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const parsed = parseBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const results: ReanchorResult[] = [];
  for (let index = 0; index < parsed.anchors.length; index += CHUNK_SIZE) {
    results.push(...reanchorExact(
      parsed.anchors.slice(index, index + CHUNK_SIZE),
      parsed.newPlainText,
    ));

    if (index + CHUNK_SIZE < parsed.anchors.length) {
      await yieldToEventLoop();
    }
  }

  return NextResponse.json({ results });
}

type ParseResult =
  | { ok: true; anchors: ReanchorInputAnchor[]; newPlainText: string }
  | { ok: false; error: string };

function parseBody(body: unknown): ParseResult {
  if (body == null || typeof body !== 'object') {
    return { ok: false, error: 'body must be an object' };
  }

  const raw = body as { anchors?: unknown; newPlainText?: unknown };
  if (typeof raw.newPlainText !== 'string') {
    return { ok: false, error: 'newPlainText must be a string' };
  }

  if (!Array.isArray(raw.anchors)) {
    return { ok: false, error: 'anchors must be an array' };
  }

  if (raw.anchors.length > MAX_ANCHORS) {
    return { ok: false, error: 'too many anchors' };
  }

  const anchors: ReanchorInputAnchor[] = [];
  for (const anchor of raw.anchors) {
    const parsed = parseAnchor(anchor);
    if (!parsed.ok) return parsed;
    anchors.push(parsed.anchor);
  }

  return { ok: true, anchors, newPlainText: raw.newPlainText };
}

type AnchorParseResult =
  | { ok: true; anchor: ReanchorInputAnchor }
  | { ok: false; error: string };

function parseAnchor(value: unknown): AnchorParseResult {
  if (value == null || typeof value !== 'object') {
    return { ok: false, error: 'anchor must be an object' };
  }

  const anchor = value as Record<string, unknown>;
  const threadId = anchor.threadId;
  const exact = anchor.exact;
  const prefix = anchor.prefix ?? null;
  const suffix = anchor.suffix ?? null;
  const start = anchor.start;
  const end = anchor.end;

  if (
    typeof threadId !== 'number'
    || typeof start !== 'number'
    || typeof end !== 'number'
    || !Number.isSafeInteger(threadId)
    || typeof exact !== 'string'
    || (prefix !== null && typeof prefix !== 'string')
    || (suffix !== null && typeof suffix !== 'string')
    || !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end < start
  ) {
    return { ok: false, error: 'anchor is malformed' };
  }

  return {
    ok: true,
    anchor: {
      threadId,
      exact,
      prefix,
      suffix,
      start,
      end,
    },
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
