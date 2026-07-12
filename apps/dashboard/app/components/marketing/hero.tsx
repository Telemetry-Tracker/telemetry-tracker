import Link from "next/link";
import { HeroDashboardScreenshot } from "@/app/components/marketing/HeroDashboardScreenshot";
import { MarketingNavLink } from "@/app/components/marketing/MarketingNavLink";

const DASHBOARD_HREF = "/dashboard/overview";

export function Hero({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const primaryHref = isAuthenticated ? DASHBOARD_HREF : "/register";
  const primaryLabel = isAuthenticated ? "Open dashboard" : "Start free — no card";
  return (
    <section className="relative overflow-hidden pt-40 pb-24 sm:pt-48 sm:pb-32">
      <div aria-hidden className="glow-blue pointer-events-none absolute inset-0 -z-10 opacity-90" />
      <div
        aria-hidden
        className="grid-bg pointer-events-none absolute inset-0 -z-20 opacity-[0.35] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_30%,#000_30%,transparent_75%)]"
      />

      <div className="mx-auto max-w-5xl px-6 text-center">
        <Link
          href="/docs"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur"
        >
          <span aria-hidden className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-pulse-dot rounded-full bg-success" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          Open source · Hosted cloud at telemetry-tracker.com
          <svg
            viewBox="0 0 16 16"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </Link>

        <h1 className="mt-7 text-balance text-3xl font-semibold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
          Observability for
          <br />
          <span className="text-muted-foreground">teams that ship.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
          Capture errors, events and sessions with lightweight SDKs. Alert on spikes, symbolicated
          stacks with source maps — one fast platform for the signals you actually act on.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-2">
          <MarketingNavLink
            href={primaryHref}
            pendingLabel={isAuthenticated ? "Opening dashboard…" : "Loading…"}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.02]"
          >
            {primaryLabel}
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </MarketingNavLink>
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-surface-elevated"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2H8v12H3.5A1.5 1.5 0 0 1 2 12.5v-9z" />
              <path d="M8 2h4.5A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5H8" />
            </svg>
            Read the docs
          </Link>
        </div>

        <p className="mt-5 text-xs text-muted-foreground">
          Designed for teams building modern web applications.
        </p>
      </div>

      <div className="mx-auto mt-16 max-w-6xl px-6 sm:mt-24">
        <div className="relative rounded-2xl border border-border-strong bg-surface/50 p-1.5 shadow-[0_30px_120px_-20px_rgba(80,140,255,0.25)] backdrop-blur">
          <div className="overflow-hidden rounded-xl border border-border">
            <HeroDashboardScreenshot />
          </div>
        </div>
      </div>
    </section>
  );
}
