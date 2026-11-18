#!/bin/sh
set -eu
# No stdout database data. Refuse overwrite and retain a private, checksummed dump.
umask 077
: "${1:?Usage: backup.sh /absolute/unique.dump}"
case "$1" in /*) ;; *) echo 'Absolute backup path required' >&2; exit 1;; esac
set -C
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
if ! sh "$root/scripts/staging/compose.sh" exec -T db pg_dump -U locker -d locker_staging -Fc > "$1"; then
  echo 'Backup failed; partial file retained for inspection, do not restore it' >&2
  exit 1
fi
sh "$root/scripts/staging/compose.sh" exec -T db pg_restore --list < "$1" > /dev/null
if command -v sha256sum >/dev/null; then (cd "$(dirname -- "$1")" && sha256sum "$(basename -- "$1")") > "$1.sha256"; else (cd "$(dirname -- "$1")" && shasum -a 256 "$(basename -- "$1")") > "$1.sha256"; fi
printf 'Backup verified: %s\n' "$1"
