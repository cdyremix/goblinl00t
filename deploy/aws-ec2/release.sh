#!/usr/bin/env bash
# Goblin L00t — release script for the AWS EC2 box.
# Run from /opt/goblinl00t after `git pull`. Idempotent; safe to re-run.
#
#   cd /opt/goblinl00t
#   git pull origin main
#   ./deploy/aws-ec2/release.sh
#
# What it does:
#   1. Installs/updates pnpm deps (frozen lockfile)
#   2. Typechecks composite libs + builds api-server bundle + dashboard
#   3. Atomically swaps the new dashboard build into /opt/goblinl00t/web
#   4. Runs `drizzle-kit push` to sync DB schema
#   5. Restarts the systemd service
set -euo pipefail

ROOT="/opt/goblinl00t"
WEB="${ROOT}/web"
ENV_FILE="/etc/goblinl00t.env"

echo "==> [1/5] Installing dependencies"
cd "$ROOT"
pnpm install --frozen-lockfile

echo "==> [2/5] Building api-server + dashboard"
# Vite needs PORT/BASE_PATH at build time even for static output, plus the
# Clerk publishable key so it's baked into the bundle.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
PORT=19458 BASE_PATH=/ NODE_ENV=production \
  VITE_CLERK_PUBLISHABLE_KEY="${VITE_CLERK_PUBLISHABLE_KEY:?set in $ENV_FILE}" \
  pnpm run typecheck:libs
PORT=19458 BASE_PATH=/ NODE_ENV=production \
  pnpm --filter @workspace/api-server run build
PORT=19458 BASE_PATH=/ NODE_ENV=production \
  VITE_CLERK_PUBLISHABLE_KEY="${VITE_CLERK_PUBLISHABLE_KEY}" \
  pnpm --filter @workspace/goblin-dashboard run build

echo "==> [3/5] Swapping dashboard into ${WEB}"
# Atomic-ish swap: rsync new files in, then prune anything no longer in
# the build. --delete would do both in one pass but it momentarily wipes
# old files before new ones are in place; --delete-after avoids that.
sudo rsync -a --delete-after \
  "${ROOT}/artifacts/goblin-dashboard/dist/public/" "${WEB}/"
sudo chown -R goblin:goblin "$WEB"
sudo chmod -R a+rX "$WEB"

echo "==> [4/5] Syncing DB schema (drizzle-kit push)"
DATABASE_URL="${DATABASE_URL}" pnpm --filter @workspace/db run push

echo "==> [5/5] Restarting goblin-l00t service"
sudo systemctl restart goblin-l00t
sleep 2
sudo systemctl --no-pager status goblin-l00t | head -15

echo
echo "Deployed. Tail logs: journalctl -u goblin-l00t -f"
