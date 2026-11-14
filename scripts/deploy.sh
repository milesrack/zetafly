#!/usr/bin/env bash
set -euo pipefail

[[ "$IMAGE" =~ ^ghcr.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]]
[[ "$REGISTRY_USER" =~ ^[a-zA-Z0-9-]+$ ]]
{
  printf '%s\n' "$GHCR_TOKEN"
  cat scripts/deploy-remote.sh
} | ssh deploy@"$DEPLOY_HOST" \
  "IFS= read -r registry_token; export registry_token; exec bash -se -- '$RELEASE_SHA' '$IMAGE' '$REGISTRY_USER'"
