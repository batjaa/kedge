#!/usr/bin/env node
// Tiny static server for the Playwright journeys' fixture documents (#26; the
// coverage pack #39 reuses it). Serves web/e2e/fixtures/ read-only on loopback
// so the "paste a public URL" step is deterministic — CI never fetches a live
// external URL. The API is allowed to reach it only because serve-api.sh puts
// this host in the test-only FETCH_ALLOW_HOSTS (see api/.env.example).
//
// Deliberately dependency-free (node:http) and dumb: GET only, an explicit
// content-type map, no directory listing, no traversal outside fixtures/.
// Booted and torn down by playwright.config.ts's webServer; run by hand with
//   node e2e/serve-fixtures.mjs

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleGithubFixtureRequest } from './github-fixture.mjs';

const ROOT = resolve(fileURLToPath(new URL('./fixtures/', import.meta.url)));
const HOST = '127.0.0.1';
const PORT = Number(process.env.FIXTURE_PORT ?? 4801);

// Real source content-types, so import's format detection sees what a genuine
// static host would send.
const CONTENT_TYPES = {
  '.md': 'text/markdown; charset=utf-8',
  '.mdx': 'text/mdx; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);

  // Readiness probe for Playwright's webServer.
  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  // Self-hosted edition stub for the landing journey (#109). The self-hosted web
  // instance (playwright.config.ts's `web-selfhosted`) points its API_URL here so
  // its server-side capability read (lib/capabilities → GET /api/v1/config) sees
  // a genuine `self_hosted: true` edition — the real edition-read path, not the
  // fail-closed fallback. That drives app/page.tsx's anonymous root to the
  // sign-in branch, proving the landing never shows on a self-hosted instance.
  // The real API's own /api/v1/config (the SaaS edition) is untouched; only this
  // separate web instance consults this stub.
  if (pathname === '/api/v1/config') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ auth: { github: false }, self_hosted: true }));
    return;
  }

  // Deterministic upstream server error (#39). A source at this path always
  // 500s, so the import-failure journey can exercise the non-2xx transient path
  // (RawUrlConnector → ImportFailedException) without a live flaky host. Also
  // stands in for a broken image URL in the import-warnings journey. Stateless —
  // every request 500s the same way, so parallel specs never race over it.
  if (pathname === '/status/500') {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('deliberate upstream error');
    return;
  }

  // The tracked-repo journey (#95): emulate the minimal GitHub REST endpoints the
  // scan pipeline calls (repo metadata, branches, recursive tree, raw contents)
  // plus the two mutation-control routes it flips between scans. Owns any
  // /repos/kedge-fixtures/… GET and /__fixture/github/* POST; everything else
  // falls through to the static fixture serving below.
  if (handleGithubFixtureRequest(req, res)) {
    return;
  }

  // Resolve strictly inside fixtures/ — anything else is a 404.
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  const file = resolve(join(ROOT, relative));
  if (relative === '' || !file.startsWith(ROOT + sep)) {
    notFound(res);
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': body.length,
    });
    res.end(body);
  } catch {
    notFound(res);
  }
});

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[fixtures] serving ${ROOT} at http://${HOST}:${PORT}`);
});
