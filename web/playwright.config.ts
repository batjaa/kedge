import { defineConfig, devices } from '@playwright/test';

// The M0 end-to-end seam (SPEC scaffold — Testing Decisions, seam 2). Exactly
// ONE journey boots both deployables against a throwaway database and drives a
// real browser through the demo criterion. It is the only automated proof that
// the Sanctum SPA cookie handshake works across the two apps, so it must be
// deterministic and non-flaky — hence no retries and a single worker.
//
// Host choices are deliberate. The browser talks to web + API over `localhost`
// so the session cookie (SESSION_DOMAIN=localhost) is same-site across both
// ports. The Node-side hops (webServer readiness polls, the BFF's server-to-
// server fetch) use `127.0.0.1` to sidestep Node resolving `localhost` to IPv6
// `::1` where the PHP dev server only listens on IPv4.

const API_PORT = 8000;
const WEB_PORT = 3000;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  // Deliberately a single journey, not a suite (breadth arrives with M2).
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

  // Boots both deployables. Playwright waits for both to answer before the
  // journey runs, and tears them down afterwards. Locally an already-running
  // stack is reused; CI always boots fresh against a scratch database.
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
      name: 'web',
      // `next dev`, not a production build: the app's `next build` currently
      // fails prerendering /_global-error (a pre-existing app-source issue,
      // unrelated to this seam — the web CI job only type-checks, never builds).
      // Dev mode also mirrors how the app actually runs today.
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
