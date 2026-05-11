#!/usr/bin/env bash
# Goblin L00t container entrypoint.
#
# 1. (Optional) Sync the DB schema. Drizzle-kit push is idempotent — safe to
#    run on every boot — but if you'd rather gate it behind a flag, set
#    RUN_DB_PUSH=false in the env and run it manually with
#      docker compose exec app pnpm --filter @workspace/db run push
# 2. Exec the configured CMD (the api-server bundle).
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[entrypoint] DATABASE_URL is not set — refusing to start." >&2
  exit 1
fi

if [[ "${RUN_DB_PUSH:-true}" == "true" ]]; then
  echo "[entrypoint] running drizzle-kit push against $(echo "$DATABASE_URL" | sed 's/:[^@]*@/:***@/')"
  pnpm --filter @workspace/db run push
fi

echo "[entrypoint] starting api-server (PORT=${PORT:-8080})"
exec "$@"
