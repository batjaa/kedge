// The one deterministic URL the M1 journey pastes (#26). Shared between
// playwright.config.ts (which boots the fixture server on this port) and the
// journey spec (which pastes the URL and asserts the doc it becomes), so the
// port and path can never drift apart.
//
// The host is 127.0.0.1 on purpose: it is an IP literal (no DNS in the loop)
// and it is exactly the host web/e2e/serve-api.sh puts in the API's test-only
// FETCH_ALLOW_HOSTS, so the SSRF guard admits this fetch — and only this host —
// in the E2E env.

export const FIXTURE_HOST = '127.0.0.1';
export const FIXTURE_PORT = 4801;

export const FIXTURE_DOC_URL = `http://${FIXTURE_HOST}:${FIXTURE_PORT}/rfc-042-anchor-re-sync.md`;

/** The first `# ` heading — import synthesizes the document title from it. */
export const FIXTURE_DOC_TITLE = 'RFC-042: Anchor re-sync protocol';
