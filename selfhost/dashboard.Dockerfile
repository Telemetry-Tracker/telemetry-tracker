# syntax = docker/dockerfile:1
# Self-host dashboard image (used by selfhost/docker-compose.yml). Build context: repo root.
#   docker build -f selfhost/dashboard.Dockerfile .
# Production on Railway keeps using the repo-root Dockerfile; this one builds a Next.js
# standalone server (traced node_modules only) and runs it as the unprivileged `node` user.

ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
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

# Public dashboard origin, inlined at build time (sitemap, robots, canonical URLs).
# Browser-exposed by design: never pass secrets as build args.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @telemetry-tracker/core build && \
    pnpm --filter @telemetry-tracker/next build && \
    pnpm --filter dashboard build

FROM node:${NODE_VERSION}-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build --chown=node:node /app/apps/dashboard/public ./apps/dashboard/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/dashboard/server.js"]
