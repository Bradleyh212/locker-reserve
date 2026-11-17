#!/bin/sh
set -eu
# Restores ONLY into a new scratch DB; never drops or overwrites locker_staging.
: "${1:?Usage: restore-check.sh /absolute/dump}"
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
if command -v sha256sum >/dev/null; then (cd "$(dirname -- "$1")" && sha256sum -c "$(basename -- "$1").sha256") >/dev/null; else (cd "$(dirname -- "$1")" && shasum -a 256 -c "$(basename -- "$1").sha256") >/dev/null; fi
scratch="restore_check_$(date +%Y%m%d%H%M%S)_$$"
sh "$root/scripts/staging/compose.sh" exec -T db createdb -U locker "$scratch"
sh "$root/scripts/staging/compose.sh" exec -T db pg_restore -U locker --dbname="$scratch" --exit-on-error --single-transaction --no-owner --no-acl < "$1"
sh "$root/scripts/staging/compose.sh" exec -T db psql -U locker -d "$scratch" -v ON_ERROR_STOP=1 -c 'SELECT COUNT(*) AS applied_migrations FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;'
printf 'Restored into isolated scratch database %s; inspect before explicitly dropping it.\n' "$scratch"
