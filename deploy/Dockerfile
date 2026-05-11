### Goblin L00t — production image
### Multi-stage build:
###   1. base    : pnpm + node toolchain (corepack)
###   2. deps    : install ALL workspace deps (including dev) for build
###   3. build   : typecheck + build api-server (esbuild bundle) + dashboard (vite static)
###   4. runtime : slim node image with only the bundled api-server, the
###                dashboard's static dist, and the prod node_modules needed
###                at runtime (stripe-replit-sync is externalized + needs its
###                node_modules folder for migrations to resolve via __dirname).

ARG NODE_VERSION=24

############################
# 1. base
############################
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /workspace

############################
# 2. deps (all workspace deps for build)
############################
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY tsconfig.base.json tsconfig.json ./
COPY artifacts ./artifacts
COPY lib ./lib
COPY scripts ./scripts
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

############################
# 3. build
############################
FROM deps AS build

ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
# Vite config in this repo requires PORT + BASE_PATH at build time even
# though the static output doesn't use PORT. BASE_PATH must be "/" for a
# root-mounted production deploy.
ENV PORT=19458
ENV BASE_PATH=/
ENV NODE_ENV=production

# Build composite libs + typecheck artifacts + run each artifact's `build`.
RUN pnpm run typecheck:libs \
 && pnpm --filter @workspace/api-server run build \
 && pnpm --filter @workspace/goblin-dashboard run build

############################
# 4. runtime
############################
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app

# Bring pnpm into the runtime image too — we use it ONCE at startup to run
# `drizzle-kit push` against the prod DB (idempotent schema sync).
RUN corepack enable && corepack prepare pnpm@10 --activate \
 && apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy the full workspace's installed node_modules. We need this because:
#   * stripe-replit-sync is externalized in build.mjs and resolves its
#     migration .sql files via __dirname relative to its own dist/ folder
#   * @workspace/db's `drizzle-kit push` is invoked at startup (entrypoint)
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/pnpm-workspace.yaml /workspace/pnpm-lock.yaml /workspace/package.json /workspace/.npmrc ./
COPY --from=build /workspace/tsconfig.base.json /workspace/tsconfig.json ./

# api-server bundled output (esbuild → dist/index.mjs) + its node_modules
# (workspace symlinks resolved by the root copy above).
COPY --from=build /workspace/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=build /workspace/artifacts/api-server/package.json ./artifacts/api-server/package.json

# Dashboard static dist served by nginx (mounted as a volume into the
# nginx container in docker-compose.yml).
COPY --from=build /workspace/artifacts/goblin-dashboard/dist ./artifacts/goblin-dashboard/dist
COPY --from=build /workspace/artifacts/goblin-dashboard/package.json ./artifacts/goblin-dashboard/package.json

# DB package (schemas + drizzle.config.ts) needed for `drizzle-kit push`
# at startup. Schema is read from .ts directly via tsx — no compile step.
COPY --from=build /workspace/lib/db ./lib/db

COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini","--","/entrypoint.sh"]
CMD ["node","--enable-source-maps","artifacts/api-server/dist/index.mjs"]
