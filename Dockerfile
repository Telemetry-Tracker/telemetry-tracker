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

# Rebuild workspace packages so dashboard never relies on incomplete committed dist.
RUN pnpm --filter @telemetry-tracker/core build && \
    pnpm --filter @telemetry-tracker/next build && \
    pnpm --filter dashboard build

FROM base AS runner

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/telemetry-core/package.json packages/telemetry-core/package.json
COPY packages/telemetry-next/package.json packages/telemetry-next/package.json

# Production install only. The build stage (no NODE_ENV=production) installs
# devDependencies for `next build` / TypeScript. Do not pass `--prod=false` here
# or those leak into the runtime image. `NODE_ENV=production` already omits them.
RUN pnpm install --frozen-lockfile

COPY --from=build /app/apps apps
COPY --from=build /app/packages packages
COPY --from=build /app/CHANGELOG.md /app/CHANGELOG.md

WORKDIR /app/apps/dashboard

EXPOSE 3000

CMD ["pnpm", "start"]
