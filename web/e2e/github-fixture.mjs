// A loopback emulation of the MINIMAL GitHub REST API surface the tracked-repo
// feature calls (#95). Imported by web/e2e/serve-fixtures.mjs (the loopback
// fixture host) and by web/e2e/tracked-repos.spec.ts (the journey), so the server
// and the spec share ONE source of truth and can never drift on paths, titles, or
// mutation outcomes.
//
// Kedge reaches this over PLAIN HTTP in the E2E env only: serve-api.sh sets
// GITHUB_API_HOST=http://127.0.0.1:4801, so the connectors build
// `http://127.0.0.1:4801/repos/...` and the SSRF guard admits it via the same
// FETCH_ALLOW_HOSTS loopback exemption that already admits the paste fixtures.
// Production is untouched (GITHUB_API_HOST defaults to api.github.com → https).
//
// It emulates EXACTLY the four endpoints App\Services\TrackedRepos\GithubRepoClient
// and App\Services\Import\Connectors\AbstractGithubBlobConnector hit, and nothing
// else:
//   GET /repos/{owner}/{repo}                         → default-branch metadata
//   GET /repos/{owner}/{repo}/branches/{ref}          → branch reachability (2A)
//   GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1 → the recursive tree
//   GET /repos/{owner}/{repo}/contents/{path}?ref=…   → the RAW file body
// The raw contents contract matters: the blob connector requests
// `Accept: application/vnd.github.raw`, so the body IS the file bytes, never
// base64 JSON.
//
// The one fixture repo is kedge-fixtures/specs @ main. It carries a docs/ tree the
// `docs/**/*.md` pattern matches: three .md files (one nested, exercising `**`)
// plus three non-matching entries. A single in-process MUTATION flag flips the
// repo to a second generation where one matched file CHANGED (a new blob sha + new
// body) and one NEW matched file appeared — the deterministic re-scan diff. No
// timers, no external deps: state is one module-local flag the journey resets,
// scans, mutates, and re-scans.

// --- Fixed identifiers -----------------------------------------------------

const OWNER = 'kedge-fixtures';
const REPO = 'specs';
const DEFAULT_BRANCH = 'main';
const REPO_PREFIX = `/repos/${OWNER}/${REPO}`;

// Opaque 40-hex blob shas — the connector treats a sha as a bare string and the
// re-scan diffs held-vs-current by equality (#94). Distinct per file; overview's
// sha differs across generations (the change signal).
const SHA = {
  overviewGen1: 'a1'.repeat(20),
  overviewGen2: 'b2'.repeat(20),
  architecture: 'c3'.repeat(20),
  gettingStarted: 'd4'.repeat(20),
  logo: 'e5'.repeat(20),
  readme: 'f6'.repeat(20),
  license: '17'.repeat(20),
  security: '28'.repeat(20),
  tree: '39'.repeat(20),
  commit: '4a'.repeat(20),
};

// --- File bodies (raw markdown; first `# ` heading becomes the doc title) ----

// The sentence a comment is anchored to before the mutation — BYTE-IDENTICAL in
// both generations so re-anchoring re-attaches it after the re-sync (the moat).
const STABLE_SENTENCE = 'Kedge tracks a repository and keeps its documents current.';
const GEN1_MARKER = 'This overview describes the first generation of the fixture repository.';
const GEN2_MARKER = 'This overview describes the second generation after the fixture repository mutated.';

/** Overview body — only the marker paragraph differs between generations. */
function overviewBody(generation) {
  const marker = generation >= 2 ? GEN2_MARKER : GEN1_MARKER;

  return [
    '# Kedge Fixture Overview',
    '',
    STABLE_SENTENCE,
    '',
    marker,
    '',
    'The overview closes with stable trailing prose so re-anchoring has context on both sides.',
    '',
  ].join('\n');
}

const ARCHITECTURE_BODY = [
  '# Kedge Fixture Architecture',
  '',
  'The architecture note explains how a tracked repository feeds a project.',
  '',
  'A scan lists the tree, matches a path pattern, and imports each file as its own document.',
  '',
].join('\n');

const GETTING_STARTED_BODY = [
  '# Getting Started',
  '',
  'This guide lives under a nested folder so the pattern must span directories.',
  '',
  'Follow the steps in order and the project fills itself from the repository.',
  '',
].join('\n');

const SECURITY_BODY = [
  '# Security Notes',
  '',
  'The security notes arrive with the second generation of the fixture repository.',
  '',
  'They exist to prove a re-scan imports a brand-new matching file.',
  '',
].join('\n');

/**
 * The current generation's file map: repo-relative path → raw body. Only the
 * files a scan actually imports (the matched .md files) need bodies — a
 * non-matching path is never fetched. Overview's body follows the generation;
 * security.md exists only in generation 2.
 */
function filesForGeneration(generation) {
  const files = {
    'docs/overview.md': overviewBody(generation),
    'docs/architecture.md': ARCHITECTURE_BODY,
    'docs/guide/getting-started.md': GETTING_STARTED_BODY,
  };

  if (generation >= 2) {
    files['docs/security.md'] = SECURITY_BODY;
  }

  return files;
}

/**
 * The recursive tree at the given generation. Directory entries (`type:"tree"`)
 * are included for realism — the connector drops everything but blobs. Overview's
 * blob sha advances in generation 2 (the "changed" signal); docs/security.md is
 * added (the "new" signal); the other blobs keep their generation-1 shas.
 */
function treeForGeneration(generation) {
  const blob = (path, sha) => ({ path, mode: '100644', type: 'blob', sha });
  const dir = (path) => ({ path, mode: '040000', type: 'tree', sha: SHA.tree });

  const entries = [
    dir('docs'),
    dir('docs/assets'),
    dir('docs/guide'),
    blob('docs/architecture.md', SHA.architecture),
    blob('docs/assets/logo.png', SHA.logo),
    blob('docs/guide/getting-started.md', SHA.gettingStarted),
    blob('docs/overview.md', generation >= 2 ? SHA.overviewGen2 : SHA.overviewGen1),
    blob('LICENSE', SHA.license),
    blob('README.md', SHA.readme),
  ];

  if (generation >= 2) {
    entries.push(blob('docs/security.md', SHA.security));
  }

  return entries;
}

// --- Mutation state --------------------------------------------------------

// The single in-process flag the journey flips. Default generation 1; the spec
// resets it at the start so a locally-reused fixture server never leaks a prior
// run's generation.
let generation = 1;

// --- Request handling ------------------------------------------------------

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function raw(res, status, body) {
  res.writeHead(status, {
    // The blob connector asked for the raw media type — the body is the file, so
    // send it as plain text exactly as GitHub's raw endpoint would.
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function notFound(res) {
  json(res, 404, { message: 'Not Found' });
}

/**
 * Handle a GitHub-emulation or mutation-control request. Returns true when it
 * owns the request (any `/repos/kedge-fixtures/…` GET or `/__fixture/github/*`
 * POST), so the caller can fall through to static file serving otherwise. Never
 * throws out to the caller.
 */
export function handleGithubFixtureRequest(req, res) {
  let url;
  try {
    url = new URL(req.url ?? '/', 'http://127.0.0.1');
  } catch {
    return false;
  }

  const method = req.method ?? 'GET';
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname;
  }

  // Mutation control (test-only).
  if (pathname === '/__fixture/github/mutate' || pathname === '/__fixture/github/reset') {
    if (method !== 'POST') {
      json(res, 405, { message: 'Method Not Allowed' });
      return true;
    }
    generation = pathname.endsWith('/reset') ? 1 : 2;
    json(res, 200, { generation });
    return true;
  }

  // Everything else this module owns is a GitHub repo read.
  if (!pathname.startsWith('/repos/')) {
    return false;
  }

  try {
    if (method !== 'GET') {
      json(res, 405, { message: 'Method Not Allowed' });
      return true;
    }

    // Only the one fixture repo exists; any other repo path 404s like GitHub.
    if (pathname !== REPO_PREFIX && !pathname.startsWith(`${REPO_PREFIX}/`)) {
      notFound(res);
      return true;
    }

    // Repo metadata / reachability probe → the default branch.
    if (pathname === REPO_PREFIX) {
      json(res, 200, { full_name: `${OWNER}/${REPO}`, default_branch: DEFAULT_BRANCH });
      return true;
    }

    const rest = pathname.slice(REPO_PREFIX.length + 1);

    // Branch reachability (2A): 200 for the default branch, 404 otherwise.
    if (rest.startsWith('branches/')) {
      const ref = rest.slice('branches/'.length);
      if (ref === DEFAULT_BRANCH) {
        json(res, 200, { name: ref, commit: { sha: SHA.commit } });
      } else {
        notFound(res);
      }
      return true;
    }

    // Recursive tree at a ref → the generation's file + directory entries.
    if (rest.startsWith('git/trees/')) {
      const ref = rest.slice('git/trees/'.length);
      if (ref !== DEFAULT_BRANCH) {
        notFound(res);
        return true;
      }
      json(res, 200, {
        sha: SHA.tree,
        url: `${REPO_PREFIX}/git/trees/${ref}`,
        truncated: false,
        tree: treeForGeneration(generation),
      });
      return true;
    }

    // Raw file contents → the generation's body for that path.
    if (rest.startsWith('contents/')) {
      const filePath = rest.slice('contents/'.length);
      const body = filesForGeneration(generation)[filePath];
      if (body === undefined) {
        notFound(res);
      } else {
        raw(res, 200, body);
      }
      return true;
    }

    notFound(res);
    return true;
  } catch {
    // A bug here must not crash the shared fixture server; surface a 500 the
    // scan classifies as an upstream failure rather than leaking the throw.
    try {
      json(res, 500, { message: 'fixture error' });
    } catch {
      /* response already sent */
    }
    return true;
  }
}

// --- Shared constants the spec asserts against -----------------------------

// Sorted by path, matching RepoDiscoveryService's `sort()` and thus the preview
// list order. Titles are each file's first `# ` heading (the synthesized title).
const MATCHED = Object.freeze([
  { path: 'docs/architecture.md', title: 'Kedge Fixture Architecture' },
  { path: 'docs/guide/getting-started.md', title: 'Getting Started' },
  { path: 'docs/overview.md', title: 'Kedge Fixture Overview' },
]);

/** The canonical fixture facts the journey drives and asserts against. */
export const GITHUB_FIXTURE = Object.freeze({
  owner: OWNER,
  repo: REPO,
  slug: `${OWNER}/${REPO}`,
  repoUrl: `https://github.com/${OWNER}/${REPO}`,
  defaultBranch: DEFAULT_BRANCH,
  pattern: 'docs/**/*.md',
  matched: MATCHED,
  nonMatching: Object.freeze(['README.md', 'LICENSE', 'docs/assets/logo.png']),
  changed: Object.freeze({
    path: 'docs/overview.md',
    title: 'Kedge Fixture Overview',
    stableSentence: STABLE_SENTENCE,
    gen1Marker: GEN1_MARKER,
    gen2Marker: GEN2_MARKER,
  }),
  added: Object.freeze({ path: 'docs/security.md', title: 'Security Notes' }),
  control: Object.freeze({
    mutate: '/__fixture/github/mutate',
    reset: '/__fixture/github/reset',
  }),
});
