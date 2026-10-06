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
# service variables into a Dockerfile build when they are declared as ARG. Keep this list
# in sync with every NEXT_PUBLIC_* the dashboard code reads (see DEPLOYMENT.md).
# Unset ARG → empty string → same as unset (feature off / default). These are
# browser-exposed by design: never add secrets here (no SENTRY_AUTH_TOKEN, R2_*, etc.).
# Changing any of them requires a rebuild, not a cached-image redeploy.
ARG NEXT_PUBLIC_AFFILIATES_ENABLED
ARG NEXT_PUBLIC_DASHBOARD_DEBUG
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID
ARG NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_TELEMETRY_API_KEY
ARG NEXT_PUBLIC_TELEMETRY_APP
ARG NEXT_PUBLIC_TELEMETRY_INGEST_URL
ARG NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD
ENV NEXT_PUBLIC_AFFILIATES_ENABLED=$NEXT_PUBLIC_AFFILIATES_ENABLED \
    NEXT_PUBLIC_DASHBOARD_DEBUG=$NEXT_PUBLIC_DASHBOARD_DEBUG \
    NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID \
    NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=$NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_TELEMETRY_API_KEY=$NEXT_PUBLIC_TELEMETRY_API_KEY \
    NEXT_PUBLIC_TELEMETRY_APP=$NEXT_PUBLIC_TELEMETRY_APP \
    NEXT_PUBLIC_TELEMETRY_INGEST_URL=$NEXT_PUBLIC_TELEMETRY_INGEST_URL \
    NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD=$NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD

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
