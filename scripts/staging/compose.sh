#!/bin/sh
set -eu
: "${STAGING_ENV_FILE:?set absolute external Compose environment file}"
case "$STAGING_ENV_FILE" in /*) ;; *) echo 'Use an absolute STAGING_ENV_FILE' >&2; exit 1;; esac
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
exec docker compose --project-name "${STAGING_PROJECT_NAME:-locker-staging}" --env-file "$STAGING_ENV_FILE" -f "$root/infra/staging/compose.yml" "$@"
