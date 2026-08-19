#!/usr/bin/env node
//
// A REAL MCP client, for the M4 `mcp-agent` journey (#137).
//
// The demo criterion (SPEC §21 M4) is "an agent connects over MCP and posts a
// review comment". Nothing short of an actual MCP client proves that: a hand-
// rolled fetch of the JSON-RPC endpoint would skip the handshake, the protocol
// negotiation, and the tool contract — the parts most likely to break. So this
// is the official `@modelcontextprotocol/sdk` client speaking streamable HTTP
// to the SERVED api on 127.0.0.1, over the same bearer token an operator mints
// in Kedge's settings page. Nothing is faked or stubbed: the transport, the
// server, the Policies, and the database rows are all real.
//
// It runs OUT OF PROCESS, spawned by the journey (see mcp-agent.ts), so it
// shares nothing with the browser or the Playwright runner but the token and
// the HTTP endpoint — exactly what a third-party agent would have.
//
// Output is one line of JSON on stdout, always:
//   { "ok": true,  ... }                       what each step returned
//   { "ok": false, "stage": …, "status": 401 } the call the server refused
// Failure is reported, never thrown: "the agent's next call fails" is an
// assertion the journey makes about the STATUS, so the status has to survive.
//
// Usage:
//   node e2e/mcp-agent.mjs --endpoint URL --token TOKEN --command review \
//        --title "RFC-300: …" --anchor "exact text" --body "the comment"
//   node e2e/mcp-agent.mjs --endpoint URL --token TOKEN --command list-documents

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** Context carried either side of the quote, matching the browser's capture. */
const CONTEXT_CHARS = 32;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    args[token.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

/** Unwrap a tool result into the structured payload the tool returned. */
function structured(result, tool) {
  if (result.isError) {
    const text = (result.content ?? [])
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join(' ')
      .trim();
    throw new Error(`tool [${tool}] returned an error: ${text || '(no message)'}`);
  }

  if (result.structuredContent !== undefined) return result.structuredContent;

  // Fall back to the text part, which carries the same JSON.
  const text = (result.content ?? []).find((part) => part.type === 'text')?.text;
  if (typeof text !== 'string') throw new Error(`tool [${tool}] returned no structured content`);
  return JSON.parse(text);
}

/**
 * Build an anchor payload the way an agent has to: locate the exact text inside
 * `version.plain_text` and report its offsets. JavaScript string indices ARE
 * UTF-16 code units, which is precisely the unit the capture path validates in,
 * so no conversion is needed — and the server re-checks that `exact` really
 * sits at these offsets, so a wrong answer here is rejected rather than stored.
 */
function anchorFor(plainText, exact, projectionVersion) {
  const start = plainText.indexOf(exact);
  if (start === -1) {
    throw new Error(`the anchor text is not in this version's projection: ${JSON.stringify(exact)}`);
  }
  if (plainText.indexOf(exact, start + 1) !== -1) {
    throw new Error(`the anchor text appears more than once: ${JSON.stringify(exact)}`);
  }

  const end = start + exact.length;

  return {
    exact,
    start,
    end,
    prefix: plainText.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: plainText.slice(end, end + CONTEXT_CHARS),
    projection_version: projectionVersion,
  };
}

async function connect({ endpoint, token }) {
  const client = new Client(
    { name: 'kedge-e2e-agent', version: '1.0.0' },
    { capabilities: {} },
  );

  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });

  // The real handshake: initialize → server capabilities → initialized.
  await client.connect(transport);

  return { client, transport };
}

/**
 * The agent's review pass: read the directory, read the document, then say
 * something about it — anchored to the exact passage, as a reviewer would.
 */
async function review(client, { title, anchor, body }) {
  const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();

  const listed = structured(await client.callTool({ name: 'list_documents', arguments: {} }), 'list_documents');
  const document = (listed.documents ?? []).find((candidate) => candidate.title === title);
  if (!document) {
    throw new Error(`list_documents did not return a document titled ${JSON.stringify(title)}`);
  }

  const read = structured(
    await client.callTool({ name: 'get_document', arguments: { document_id: document.id } }),
    'get_document',
  );
  const version = read.version;
  if (!version || typeof version.plain_text !== 'string') {
    throw new Error('get_document returned no readable version projection');
  }

  const posted = structured(
    await client.callTool({
      name: 'post_comment',
      arguments: {
        document_id: document.id,
        version_id: version.id,
        body,
        anchor: anchorFor(version.plain_text, anchor, version.projection_version),
      },
    }),
    'post_comment',
  );

  const thread = posted.thread ?? {};
  const comment = (thread.comments ?? [])[0] ?? null;

  return {
    tools,
    document: { id: document.id, title: document.title },
    version: { id: version.id, projection_version: version.projection_version },
    thread: { id: thread.id ?? null, anchor_exact: thread.anchor?.exact ?? null },
    comment: comment === null ? null : { id: comment.id, client: comment.client, body_md: comment.body_md },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args.command ?? 'review';
  let session = null;

  try {
    session = await connect({ endpoint: args.endpoint, token: args.token });

    const payload = command === 'list-documents'
      ? {
        documents: structured(
          await session.client.callTool({ name: 'list_documents', arguments: {} }),
          'list_documents',
        ).documents.map((document) => ({ id: document.id, title: document.title })),
      }
      : await review(session.client, { title: args.title, anchor: args.anchor, body: args.body });

    process.stdout.write(`${JSON.stringify({ ok: true, command, ...payload })}\n`);
  } catch (error) {
    // `code` is the HTTP status on a StreamableHTTPError — the thing that tells
    // a revoked token (401) apart from a tool refusal or a crashed server.
    process.stdout.write(`${JSON.stringify({
      ok: false,
      command,
      status: typeof error?.code === 'number' ? error.code : null,
      message: String(error?.message ?? error),
    })}\n`);
    process.exitCode = 1;
  } finally {
    await session?.transport.terminateSession().catch(() => {});
    await session?.client.close().catch(() => {});
  }
}

await main();
