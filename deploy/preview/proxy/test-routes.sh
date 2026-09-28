#!/usr/bin/env bash
# Exercise the shipped Caddyfile, not a hand-parsed approximation of it.
#
# Two disposable marker upstreams stand in for the api and web containers. This
# isolates the routing contract from Laravel/Next behavior while proving Caddy
# receives the relevant paths and chooses the right upstream. It intentionally
# runs in the E2E CI job, where Docker is available; it is also safe to run on a
# developer machine with Docker.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
run_id="kedge-proxy-route-$$-$RANDOM"
network="$run_id"
api_container="${run_id}-api"
web_container="${run_id}-web"
proxy_container="${run_id}-proxy"
image="${run_id}:latest"

cleanup() {
  docker rm -f "$proxy_container" "$api_container" "$web_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run -d --name "$api_container" --network "$network" --network-alias api \
  hashicorp/http-echo:1.0.0 -listen=:80 -text=api >/dev/null
docker run -d --name "$web_container" --network "$network" --network-alias web \
  hashicorp/http-echo:1.0.0 -listen=:3000 -text=web >/dev/null
docker build --quiet --tag "$image" "$repo_root/deploy/preview/proxy" >/dev/null
docker run -d --name "$proxy_container" --network "$network" -p 127.0.0.1::80 "$image" >/dev/null

proxy_port="$(docker port "$proxy_container" 80/tcp | sed -n '1s/.*://p')"
if [[ -z "$proxy_port" ]]; then
  echo "Caddy test container has no published HTTP port" >&2
  exit 1
fi

assert_upstream() {
  local method="$1"
  local path="$2"
  local expected="$3"
  local actual=""

  for _ in {1..20}; do
    actual="$(curl --fail --silent --show-error --request "$method" "http://127.0.0.1:${proxy_port}${path}" 2>/dev/null || true)"
    [[ "$actual" == "$expected" ]] && return 0
    sleep 0.25
  done

  echo "expected ${method} ${path} to reach ${expected}, got ${actual:-no response}" >&2
  docker logs "$proxy_container" >&2 || true
  exit 1
}

# /email routes are Laravel root routes, not API-v1 paths. The first is shaped
# like a signed confirmation URL; the second is the authenticated resend POST.
assert_upstream GET '/email/verify/1/example-hash?expires=1&signature=example' api
assert_upstream POST '/email/verification-notification' api

# Keep the routes whose ordering makes the confirmation fix safe.
assert_upstream GET '/api/bff/me' web
assert_upstream GET '/verify-email' web
