#!/usr/bin/env bash
set -euo pipefail

node scripts/serve-ui.ts > /tmp/zetafly-ui.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
curl --fail --silent --show-error --retry 20 --retry-connrefused --retry-delay 1 http://127.0.0.1:3000/ >/dev/null
node "scripts/verify-$1.ts"
