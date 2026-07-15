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
