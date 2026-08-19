import { defineConfig, devices } from '@playwright/test';
import { FIXTURE_PORT } from './e2e/fixture-doc';

// The end-to-end seam: a journey PACK across every shipped surface (#39), grown
// from the original one-journey-per-module seams — M0's demo criterion (the
// cross-app Sanctum cookie handshake, seam 2 of the scaffold spec) and M1's
// (paste → render with a live diagram → share → claim, seam 3 of the
// import-render spec). The pack now also covers auth edges, URL/paste/HTML
// import + failures + warnings, MDX safety in the browser, the share lifecycle,
// diagram rendering, PAT settings, and — from M4 (#137) — the agent/AI surfaces:
// a real MCP client hop under a token minted in the UI, AI triage in the thread
// panel, and AI-proposed comment splits. Each journey boots the deployables
// against a throwaway database and drives a real browser; every spec registers
// its OWN unique user and creates its OWN documents (e2e/helpers.ts), so no spec
// depends on another's state. They must be deterministic and non-flaky — hence
// no retries. `workers: 1` is a scope choice, not a correctness requirement: the
// pack is written worker-safe and stays green at `--workers=4` (proven locally),
// so raising it later is a one-line change.
//
// Host choices are deliberate. The browser talks to web + API over `localhost`
// so the session cookie (SESSION_DOMAIN=localhost) is same-site across both
// ports. The Node-side hops (webServer readiness polls, the BFF's server-to-
// server fetch) use `127.0.0.1` to sidestep Node resolving `localhost` to IPv6
// `::1` where the PHP dev server only listens on IPv4. The M1 fixture document
// is served on 127.0.0.1 too — an IP literal keeps DNS out of the SSRF guard's
// path, and it is exactly the host serve-api.sh allowlists (FETCH_ALLOW_HOSTS).

const API_PORT = 8000;
const WEB_PORT = 3000;
// A second web instance for the landing journey's self-hosted branch (#109). It
// points at the fixtures server's self_hosted:true /config stub instead of the
// real (SaaS) API, so its anonymous root redirects to sign-in — the only way to
// exercise a server-decided edition branch is a web process with that edition's
// config source. Kept separate so the SaaS journeys keep the real API untouched.
const WEB_SELFHOSTED_PORT = 3100;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  // The pack is worker-safe (unique users/docs per spec), so CI spreads spec
  // FILES across 4 workers — the runner's vCPU count — which roughly halves the
  // serial pack. fullyParallel stays off: tests within one file keep their
  // order (some specs build state test-to-test), which is also exactly the
  // shape the pack was proven green at (`--workers=4` parallelizes files, not
  // in-file tests). Locally the default stays serial for deterministic output;
  // pass --workers=N to opt in.
  fullyParallel: false,
  workers: isCI ? 4 : 1,
  // A flaky seam is worse than none: fail loudly instead of masking with retries.
  retries: 0,
  forbidOnly: isCI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    navigationTimeout: 30_000,
  },

  projects: [
    // Chromium only — one browser keeps CI light; the seam proves the handshake,
    // not cross-browser rendering.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Boots both deployables plus the loopback fixture host the import journeys
  // paste from. Playwright waits for all three to answer before the journeys
  // run, and tears them down afterwards. Locally an already-running stack is
  // reused; CI always boots fresh against a scratch database.
  //
  // NOTE: the API *must* come up via serve-api.sh — its generated E2E env
  // carries the FETCH_ALLOW_HOSTS fixture exemption, the sync queue, the array
  // cache store that keeps rate limiters from coupling the pack's many users,
  // and the fake-key + scripted-AI pair the M4 journeys assert content against
  // (no live model call, ever). A dev API already running on :8000 against
  // api/.env will be reused instead and the import journeys will fail
  // (SSRF-blocked fixture URL): stop that server before running the journeys
  // locally.
  webServer: [
    {
      name: 'api',
      command: 'bash e2e/serve-api.sh',
      url: `http://127.0.0.1:${API_PORT}/up`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      name: 'fixtures',
      // The deterministic "public URL" source (#26, extended for the #39 pack):
      // a dependency-free static server over web/e2e/fixtures, plus a /status/500
      // route for the transient-failure and broken-image journeys. See
      // e2e/fixtures.ts for the URLs the journeys paste.
      command: 'node e2e/serve-fixtures.mjs',
      url: `http://127.0.0.1:${FIXTURE_PORT}/health`,
      reuseExistingServer: !isCI,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        FIXTURE_PORT: String(FIXTURE_PORT),
      },
    },
    {
      name: 'web',
      // CI serves the PRODUCTION build (ci.yml builds it in the step before the
      // pack); local runs keep `next dev`. The old deferral note ("rebuilding
      // on every e2e run costs more than it proves for this single handshake
      // journey") predates the 47-test pack: on a 4-vCPU runner, dev-mode
      // compile-on-demand starved 4 parallel browsers so badly the parallel
      // pack ran no faster than serial. One build serves BOTH web instances —
      // NEXT_PUBLIC_API_URL's baked default is already the :8000 the primary
      // needs, and the self-hosted instance's client never calls the API.
      command: isCI
        ? `npm run start -- --hostname 127.0.0.1 --port ${WEB_PORT}`
        : `npm run dev -- --hostname 127.0.0.1 --port ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}/docs`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        // Server-side BFF hop stays on IPv4; browser hop stays on localhost.
        API_URL: `http://127.0.0.1:${API_PORT}`,
        NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`,
      },
    },
    {
      name: 'web-selfhosted',
      // The self-hosted edition under test (#109): a second `next dev` whose
      // server-side capability read points at the fixtures server's
      // self_hosted:true /config stub, not the real SaaS API. That is the only
      // faithful way to exercise app/page.tsx's edition branch end-to-end — the
      // edition is decided server-side from API_URL, fixed per web process. Its
      // anonymous root therefore redirects to sign-in; the landing journey drives
      // it to prove the marketing surface never leaks to a self-hosted instance.
      // Readiness is /docs (static fumadocs, no API needed). NEXT_PUBLIC_API_URL
      // rides along for parity though this branch never makes a client API call.
      command: isCI
        ? `npm run start -- --hostname 127.0.0.1 --port ${WEB_SELFHOSTED_PORT}`
        : `npm run dev -- --hostname 127.0.0.1 --port ${WEB_SELFHOSTED_PORT}`,
      url: `http://127.0.0.1:${WEB_SELFHOSTED_PORT}/docs`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        API_URL: `http://127.0.0.1:${FIXTURE_PORT}`,
        NEXT_PUBLIC_API_URL: `http://localhost:${FIXTURE_PORT}`,
        // Own compile dir so this second DEV server never races the primary
        // web instance over `.next` (next.config.mjs reads NEXT_DIST_DIR). In
        // CI both instances `next start` from the one read-only production
        // build, so the dir split is dev-only.
        ...(isCI ? {} : { NEXT_DIST_DIR: '.next-selfhosted' }),
      },
    },
  ],
});
