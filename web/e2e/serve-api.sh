#!/usr/bin/env bash
#
# Boot the Kedge API for the Playwright journey against a throwaway database.
#
# The E2E seam must be deterministic and must never touch a developer's real
# dev database. So the API runs under its own `e2e` environment: a generated
# api/.env.e2e (never committed) plus a fresh api/database/e2e.sqlite migrated
# from scratch on every boot. Both are picked up because APP_ENV=e2e is in the
# `php artisan serve` passthrough allowlist, so Laravel loads .env.e2e in the
# served worker too (a plain DB_DATABASE override would NOT survive the serve
# subprocess). The dev's api/.env and database.sqlite are left untouched.
#
# Invoked by playwright.config.ts's webServer; can also be run by hand.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/../../api" && pwd)"
cd "${API_DIR}"

ENV_FILE="${API_DIR}/.env.e2e"
DB_FILE="${API_DIR}/database/e2e.sqlite"
PORT="${API_PORT:-8000}"

# APP_ENV=e2e makes every artisan call below (and the served worker) read
# .env.e2e instead of .env.
export APP_ENV=e2e

# Generate a fresh scratch env every run: the committed example verbatim, with
# the E2E overrides appended BELOW it. Order matters — Laravel's dotenv lets a
# later line in the same file overwrite an earlier one (only pre-existing real
# environment variables are immutable), so the block at the BOTTOM wins over the
# identically-named lines in the example. (An override placed above the example
# would silently lose — that bug shipped and was caught by the M1 journey.)
# Everything not overridden — the auth-handshake knobs (SESSION_DOMAIN /
# SANCTUM_STATEFUL_DOMAINS / CORS) and the empty APP_KEY that key:generate fills
# — comes straight from the example, so the E2E env can never silently drift
# from a real deployment.
#
# The M1 journey (#26) adds four overrides:
#   QUEUE_CONNECTION=sync   imports run inline in the request instead of on a
#                           database queue worker this script would otherwise
#                           have to babysit. The journey asserts user-visible
#                           import outcomes; the async 202→poll lifecycle is
#                           covered by the API feature tests.
#   PROJECTION_URL          pinned to IPv4 for the API→web projection hop, same
#                           localhost-vs-::1 reasoning as playwright.config.ts.
#   KROKI_URL               passthrough: CI points it at the job's Kroki service
#                           container; locally it defaults to the dev default
#                           (hosted kroki.io — SPEC §6.2 allows that in local
#                           dev only).
#   FETCH_ALLOW_HOSTS       the TEST-ONLY SSRF-guard escape hatch (see
#                           api/.env.example): admits exactly the loopback host
#                           the fixture server (e2e/serve-fixtures.mjs) binds,
#                           so the pasted fixture URL survives the guard. Never
#                           set this outside this throwaway env.
#   GITHUB_API_HOST         the TEST-ONLY GitHub API base (config/kedge.php,
#                           M3.6 seam): points every GitHub REST call at the same
#                           loopback fixture host, which emulates the minimal
#                           repo/branches/tree/contents endpoints for the
#                           tracked-repo journey (#95). Carries an http:// scheme
#                           so the call reaches the plain-http fixture server —
#                           admitted by the same FETCH_ALLOW_HOSTS loopback
#                           exemption. Production defaults to api.github.com
#                           (https); never set this outside this throwaway env.
#                           The port MUST match e2e/fixture-doc.ts (FIXTURE_PORT).
#
# The journey-pack (#39) adds one more:
#   CACHE_STORE=array       the pack drives every shipped surface as many unique
#                           users over one loopback IP. The cache-backed rate
#                           limiters (throttle:auth/imports/shares/integrations,
#                           App\Providers\AppServiceProvider) all key on
#                           user-or-IP, so with the example's persistent
#                           `database` store their counters would be SHARED
#                           across independent journeys — a limit tripped in one
#                           spec would 429 an unrelated one, and raising workers
#                           (the pack is written worker-safe) would cluster the
#                           auth bucket past its 10/min ceiling. `array` is
#                           per-request under `php artisan serve` (each request
#                           bootstraps fresh), so the counters never persist and
#                           throttling stops coupling otherwise-isolated
#                           journeys. Nothing else in the app reads the cache
#                           (the diagram cache is on the media disk), and
#                           rate-limit BEHAVIOUR has its own API feature tests —
#                           so this only removes cross-journey interference, it
#                           never weakens a real assertion.
#
# The M4 journey pack (#137) adds two, and they belong together:
#   ANTHROPIC_API_KEY       an OBVIOUSLY FAKE value. It is never sent anywhere —
#                           see AI_FAKE_RESPONSES below — but the AI surface is
#                           BYO-key gated (config/kedge.php), so without a key
#                           present /config reports ai.enabled=false and the web
#                           renders no AI affordance at all. The key's only job
#                           here is to turn the surface on.
#   AI_FAKE_RESPONSES=true  every model call is answered by the scripted fake in
#                           App\Providers\FakeAiServiceProvider instead of the
#                           provider — deterministic output the journeys assert,
#                           and NO live model call from any suite (SPEC §18.8).
#                           Honored only under APP_ENV=e2e/testing, so it cannot
#                           leak into a real deployment.
{
  echo "# Generated by web/e2e/serve-api.sh — throwaway E2E env. Do not commit."
  cat "${API_DIR}/.env.example"
  echo ""
  echo "# --- E2E overrides (must stay BELOW the example: last line wins) ---"
  echo "APP_ENV=e2e"
  echo "DB_CONNECTION=sqlite"
  echo "DB_DATABASE=${DB_FILE}"
  # The three lines below exist because the server runs multiple PHP workers
  # (see PHP_CLI_SERVER_WORKERS at the bottom): concurrent requests mean
  # concurrent SQLite writers, and the driver's defaults (rollback journal,
  # no lock wait, DEFERRED transactions) throw "database is locked" the moment
  # two overlap — 28 such errors in one 4-worker pack run. WAL lets readers and
  # the writer coexist, IMMEDIATE takes the write lock at BEGIN so a
  # transaction never has to upgrade mid-flight (the unwaitable-deadlock case),
  # and busy_timeout makes the queued writer wait instead of failing.
  echo "DB_JOURNAL_MODE=WAL"
  echo "DB_BUSY_TIMEOUT=5000"
  echo "DB_TRANSACTION_MODE=IMMEDIATE"
  echo "MAIL_MAILER=log"
  echo "QUEUE_CONNECTION=sync"
  echo "CACHE_STORE=array"
  echo "LOG_CHANNEL=single"
  echo "MAIL_LOG_CHANNEL=single"
  echo "PROJECTION_URL=http://127.0.0.1:${WEB_PORT:-3000}"
  echo "KROKI_URL=${KROKI_URL:-https://kroki.io}"
  echo "FETCH_ALLOW_HOSTS=127.0.0.1"
  echo "GITHUB_API_HOST=http://127.0.0.1:${FIXTURE_PORT:-4801}"
  echo "ANTHROPIC_API_KEY=e2e-fake-key-never-sent-anywhere"
  echo "AI_FAKE_RESPONSES=true"
} >"${ENV_FILE}"

php artisan key:generate --force

# Fresh SQLite file, migrated from zero — no state survives between runs.
rm -f "${DB_FILE}"
touch "${DB_FILE}"
php artisan migrate --force

# The diagram render cache (SPEC §6.2) serves cached SVGs from public/storage →
# storage/app/public. The symlink is not committed, so a fresh checkout (CI)
# needs it created before the first diagram renders. Idempotent.
php artisan storage:link --force

# The M2 reviewer journey reads the log-driver mailbox from this known file.
# Keep it bounded for a fresh e2e boot; reused local servers still work because
# each spec filters by a unique recipient email.
: >"${API_DIR}/storage/logs/laravel.log"

# --no-reload: no file watcher (deterministic) and a single served process.
#
# PHP_CLI_SERVER_WORKERS: PHP's built-in server handles ONE request at a time
# per worker, and the pack now runs 4 Playwright workers in CI — a single-worker
# API queues their overlapping browser + BFF requests until Node's fetch times
# out and the page renders "API is unreachable". Sized above the Playwright
# worker count because one journey issues several requests at once. Each request
# still bootstraps fresh in every worker, so the CACHE_STORE=array reasoning
# above is unchanged.
export PHP_CLI_SERVER_WORKERS="${PHP_CLI_SERVER_WORKERS:-6}"
exec php artisan serve --host=127.0.0.1 --port="${PORT}" --no-reload
