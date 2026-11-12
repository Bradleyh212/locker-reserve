#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROJECT="locker-reservation-e2e-$$"
compose() { docker compose -p "$PROJECT" -f "$ROOT/infra/test/reservation-compose.yml" "$@"; }
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ]; then compose logs --tail=60 || true; fi
  if ! compose down --volumes; then
    printf '%s\n' "Could not remove test project $PROJECT; inspect Docker and clean up that project." >&2
    if [ "$status" -eq 0 ]; then status=1; fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
compose up -d --wait --wait-timeout 60
export NODE_ENV=test RESERVATION_E2E=1
export DATABASE_URL='postgresql://ci:ci@127.0.0.1:55440/locker_reservation_e2e?schema=public'
export REDIS_URL='redis://127.0.0.1:56390/15'
cd "$ROOT/services/api"
node -e 'require("./test/reservation/environment.cjs").assertTestTargets(process.env)'
npx --no-install prisma generate
npx --no-install prisma migrate deploy
npm run test:reservation -- "$@"
