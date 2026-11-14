#!/usr/bin/env bash
set -euo pipefail

test -n "$DEPLOY_SSH_KEY"
test -n "$DEPLOY_KNOWN_HOSTS"
install -d -m 700 ~/.ssh
printf '%s\n' "$DEPLOY_SSH_KEY" > ~/.ssh/id_ed25519
chmod 600 ~/.ssh/id_ed25519
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > ~/.ssh/known_hosts
cat > ~/.ssh/config <<'SSH'
Host *
  BatchMode yes
  StrictHostKeyChecking yes
  IdentitiesOnly yes
  ServerAliveInterval 30
SSH

