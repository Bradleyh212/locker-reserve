#!/bin/sh
# Build only tracked source. Publish exactly the locally verified image IDs.
set -eu
mode=${1:?verify or publish}
case "$mode" in verify|publish) ;; *) exit 2;; esac
sha=$(git rev-parse HEAD)
[ "$sha" = "${GITHUB_SHA:-$sha}" ]
case "${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:-}" in pk_test_*) ;; *) echo 'Missing test publishable key' >&2; exit 1;; esac
export NEXT_PUBLIC_API_BASE_URL=https://staging.lockerreserve.com/api
source_url=https://github.com/Bradleyh212/locker-reserve
prefix=ghcr.io/bradleyh212/locker-reserve
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git archive "$sha" services/api services/web | tar -x -C "$tmp"
# Check the actual tracked contexts before Docker reads any layer. Fail without
# displaying matched content. The workflow passes only public browser settings.
python3 - "$tmp/services" <<'PYSCAN'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
for path in root.rglob('*'):
    if path.is_symlink():
        sys.exit('Unexpected symlink in release context')
    if path.is_file():
        if (path.name in {'.env', '.env.local', '.npmrc', 'config.local.h'} or
            path.suffix.lower() in {'.pem', '.p12', '.key', '.pfx'} or
            re.search(rb'-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----|(?:sk_live_|sk_test_|ghp_)[A-Za-z0-9]{20,}', path.read_bytes())):
            sys.exit('Unexpected credential material in release context')
PYSCAN
# Exercise both Docker allowlists with synthetic private files. A scratch COPY
# exposes exactly the files available to any COPY instruction, including builders.
for context in api web; do
  for fixture in .env .env.local; do
    printf 'CI-only build exclusion probe\n' > "$tmp/services/$context/$fixture"
  done
  printf 'FROM scratch\nCOPY . /\n' | docker buildx build --platform linux/amd64 \
    -f - --output "type=local,dest=$tmp/visible-$context" "$tmp/services/$context"
  test ! -e "$tmp/visible-$context/.env"
  test ! -e "$tmp/visible-$context/.env.local"
done
for svc in api web migrate; do
  context=api; target=runner
  case "$svc" in web) context=web;; migrate) target=migrator;; esac
  image="$prefix-$svc:sha-$sha"
  docker buildx build --load --platform linux/amd64 --provenance=false \
    --label "org.opencontainers.image.source=$source_url" \
    --label "org.opencontainers.image.revision=$sha" \
    --label "org.lockerreserve.service=$svc" \
    --label "org.lockerreserve.public-key-sha256=$(printf %s "$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" | sha256sum | cut -d' ' -f1)" \
    --build-arg NEXT_PUBLIC_API_BASE_URL --build-arg NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    --target "$target" -t "$image" "$tmp/services/$context"
  [ "$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$image")" = linux/amd64 ]
  case "$svc" in
    api) file=dist/main.js;;
    web) file=server.js;;
    migrate) file=node_modules/.bin/prisma;;
  esac
  docker run --platform linux/amd64 --rm --network none --entrypoint sh "$image" -ec 'test -s "/app/$1" && test ! -e /app/.env && test ! -e /app/.env.local && test ! -e /app/.git' sh "$file"
  if [ "$mode" = publish ]; then
    id=$(docker image inspect -f '{{.Id}}' "$image")
    docker push "$image" > "$tmp/push.log"
    digest=$(awk '/digest: sha256:/ {for(i=1;i<NF;i++) if($i=="digest:") print $(i+1)}' "$tmp/push.log")
    printf '%s\n' "$digest" | grep -Eq '^sha256:[0-9a-f]{64}$'
    ref="$prefix-$svc@$digest"
    docker pull --platform linux/amd64 "$ref"
    [ "$(docker image inspect -f '{{.Id}}' "$ref")" = "$id" ]
    printf '%s=%s\n' "$svc" "${ref##*@}" >> "${GITHUB_OUTPUT:?}"
  fi
done
