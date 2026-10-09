# syntax = docker/dockerfile:1
# API image (also used by retention-cron, alert-rules-evaluator, alert-webhook-worker).
# Build context MUST be the repo root so pnpm-lock.yaml is used:
#   docker build -f apps/api/Dockerfile .
# Railway: Root Directory = empty, Builder = Dockerfile, Dockerfile path = apps/api/Dockerfile
# (RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile). Do NOT point the API at the repo-root
# Dockerfile; that one is the dashboard image.
#
# Replaces the Railpack build (root apps/api), which ran `npm install` without any
# lockfile, ignored the root pnpm.overrides and resolved versions at deploy time.

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-slim AS base
# Prisma needs OpenSSL at generate time and at runtime.
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
# Pin pnpm to the root package.json `packageManager` (pnpm@9.15.9).
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml CHANGELOG.md ./
COPY apps/api apps/api
# Exact lockfile versions for the API and its workspace deps only. Fails if the
# lockfile is out of date instead of silently re-resolving.
RUN pnpm install --frozen-lockfile --filter api...
RUN pnpm --filter api build
# Production-only, self-contained copy of the API (no devDependencies, no symlinks
# into the workspace). Runs the API postinstall (api-version + prisma generate).
RUN pnpm --filter api deploy --prod /out && \
    cp -R apps/api/dist /out/dist && \
    cd /out && node node_modules/prisma/build/index.js generate

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
# Railway sets PORT (8080); the API defaults to 3001 when unset.
EXPOSE 8080
# Same as the Railpack start (`npm run start` -> node dist/index.js). Cron/worker
# services keep their own start commands, e.g. node dist/jobs/run-retention.js.
CMD ["node", "dist/index.js"]
