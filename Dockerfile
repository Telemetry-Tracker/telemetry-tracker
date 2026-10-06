# Dashboard image — build context must be repo root (packages/, pnpm workspace, root eslint.config.mjs).
# Railway dashboard service: Root Directory = empty, Build → Dockerfile path = this file. Do not use for API.
# syntax = docker/dockerfile:1

ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-slim AS base

WORKDIR /app

# Pin pnpm 9 (matches CI / lockfile v9). pnpm 11+ requires Node 22+ and breaks on node:20-slim.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

FROM base AS build

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y python-is-python3 build-essential pkg-config && \
    rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/telemetry-core/package.json packages/telemetry-core/package.json
COPY packages/telemetry-next/package.json packages/telemetry-next/package.json

RUN pnpm install --frozen-lockfile

COPY apps apps
COPY packages packages
COPY CHANGELOG.md CHANGELOG.md
COPY eslint.config.mjs ./eslint.config.mjs

# Next.js inlines NEXT_PUBLIC_* into the bundle at `next build`, and Railway only passes
# service variables into a Dockerfile build when they are declared as ARG. Unset ARG →
# empty string → flag off (same as before). Changing it requires a rebuild, not a
# cached-image redeploy. See docs/AFFILIATES.md.
ARG NEXT_PUBLIC_AFFILIATES_ENABLED
ENV NEXT_PUBLIC_AFFILIATES_ENABLED=$NEXT_PUBLIC_AFFILIATES_ENABLED

# Rebuild workspace packages so dashboard never relies on incomplete committed dist.
RUN pnpm --filter @telemetry-tracker/core build && \
    pnpm --filter @telemetry-tracker/next build && \
    pnpm --filter dashboard build

FROM base AS runner

ENV NODE_ENV=production

# Copy the built workspace (node_modules compiled with build-essential, plus
# `.next`). Do not reinstall here: a production-only `pnpm install` in this
# stage first ran on Railway in v1.17.7 (v1.17.6 skipped the dashboard watch
# paths) and the deploy failed, leaving telemetry-tracker.com on Cloudflare 502.
COPY --from=build /app /app

WORKDIR /app/apps/dashboard

EXPOSE 3000

CMD ["pnpm", "start"]
