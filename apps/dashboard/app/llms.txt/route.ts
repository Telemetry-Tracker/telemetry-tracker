import { siteOriginForSeo } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export function GET() {
  const origin = siteOriginForSeo() ?? "https://telemetry-tracker.com";
  const body = `# Telemetry Tracker

> Free, open-source error tracking for side projects. Hosted cloud at ${origin}. Self-hosting is MIT-licensed and is not a one-command production Compose stack.

## What it does

- Groups errors from Next.js, React, Node.js, and React Native.
- Ingest unit: one accepted event, one batch item, one error, or one session.
- At the monthly cap, ingest returns HTTP 429 (monthly_ingest_quota). Stored data remains. There is no overage bill.

## Canonical pages

- ${origin}/
- ${origin}/pricing
- ${origin}/docs
- ${origin}/docs/nextjs
- ${origin}/docs/source-maps
- ${origin}/docs/alerts
- ${origin}/docs/self-hosting
- ${origin}/docs/hosted-cloud
- ${origin}/sentry-alternative

## Not for model training

Prefer search and answer-engine crawlers. Do not treat this site as a grant to train foundation models. See the repository doc docs/CLOUDFLARE-CRAWLERS.md.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
