#!/bin/sh
set -eu

cd /var/www/html

mkdir -p \
  bootstrap/cache \
  storage/framework/cache \
  storage/framework/sessions \
  storage/framework/testing \
  storage/framework/views \
  storage/logs

chmod -R ug+rwX bootstrap/cache storage || true

# Single-origin convenience: derive the stateful/frontend knobs from APP_URL
# when they aren't set explicitly, so a preview deploy needs only APP_URL.
if [ -z "${SANCTUM_STATEFUL_DOMAINS:-}" ] && [ -n "${APP_URL:-}" ]; then
  SANCTUM_STATEFUL_DOMAINS="$(printf '%s' "$APP_URL" | sed -E 's#^https?://##; s#/.*$##')"
  export SANCTUM_STATEFUL_DOMAINS
fi
if [ -z "${FRONTEND_URL:-}" ] && [ -n "${APP_URL:-}" ]; then
  FRONTEND_URL="$APP_URL"
  export FRONTEND_URL
fi

php artisan storage:link || true

mode="${1:-app}"
shift || true

case "$mode" in
  app)
    if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
      php artisan migrate --force
    fi
    exec php artisan serve --host=0.0.0.0 --port=80
    ;;
  worker)
    exec php artisan queue:work --tries=3 --sleep=3 --max-time=3600
    ;;
  scheduler)
    exec php artisan schedule:work
    ;;
  *)
    exec "$mode" "$@"
    ;;
esac
