#!/usr/bin/env bash
set -euo pipefail
release=/var/www/zetafly/releases/$1
cd "$release"
test -r /var/www/zetafly/shared/.env
ln -sfn /var/www/zetafly/shared/.env .env
printf 'ZETAFLY_IMAGE=%s\n' "$2" > image.env
export DOCKER_CONFIG
DOCKER_CONFIG=$(mktemp -d)
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
printf '%s' "$registry_token" | docker login ghcr.io --username "$3" --password-stdin >/dev/null
unset registry_token
compose=(docker compose -p zetafly --env-file .env --env-file image.env -f compose.yaml -f compose.production.yaml)
"${compose[@]}" pull
"${compose[@]}" up -d --no-build --wait --wait-timeout 180
curl --fail --silent --show-error http://127.0.0.1:3000/api/health >/dev/null
curl --fail --silent --show-error --retry 5 --retry-delay 3 https://zetafly.poosd.dev/api/health >/dev/null
ln -sfn "$release" /var/www/zetafly/current
