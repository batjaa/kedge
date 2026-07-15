import { defineConfig, devices } from '@playwright/test';
import { FIXTURE_PORT } from './e2e/fixture-doc';

// The end-to-end seam: ONE journey per module — M0's demo criterion (the
// cross-app Sanctum cookie handshake, seam 2 of the scaffold spec) and M1's
// (paste → render with a live diagram → share → claim, seam 3 of the
// import-render spec). Each journey boots the deployables against a throwaway
// database and drives a real browser; deliberately journeys, never a suite, and
// they must be deterministic and non-flaky — hence no retries and a single
// worker.
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
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  // Deliberately one journey per module, not a suite (the M1 coverage pack is
  // #39; breadth beyond that arrives with M2).
  fullyParallel: false,
  workers: 1,
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

  // Boots both deployables plus the loopback fixture host the M1 journey pastes
  // from. Playwright waits for all three to answer before the journeys run, and
  // tears them down afterwards. Locally an already-running stack is reused; CI
  // always boots fresh against a scratch database.
  //
  // NOTE (M1): the API *must* come up via serve-api.sh — its generated E2E env
  // carries the FETCH_ALLOW_HOSTS fixture exemption and the sync queue. A dev
  // API already running on :8000 against api/.env will be reused instead and
  // the M1 journey will fail its import (SSRF-blocked fixture URL): stop that
  // server before running the journeys locally.
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
      // The deterministic "public URL" source (#26): a dependency-free static
      // server over web/e2e/fixtures. See e2e/fixture-doc.ts for the one URL
      // the journey pastes.
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
      // `next dev`, not a production build. The `next build` /_global-error
      // prerender failure is fixed (#14), so a built app is now possible, but
      // the swap is deferred: NEXT_PUBLIC_* below are build-time inlined, so a
      // production run would need them baked at build, and rebuilding on every
      // e2e run costs more than it proves for this single handshake journey.
      command: `npm run dev -- --hostname 127.0.0.1 --port ${WEB_PORT}`,
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
  ],
});
