import Link from "next/link";
import { MarketingNavLink } from "@/app/components/marketing/MarketingNavLink";

const DASHBOARD_HREF = "/dashboard/overview";

export function Cta({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const primaryHref = isAuthenticated ? DASHBOARD_HREF : "/register";
  const primaryLabel = isAuthenticated ? "Open dashboard" : "Start free";

  return (
    <section className="relative py-28">
      <div className="mx-auto max-w-5xl px-6">
        <div className="relative overflow-hidden rounded-3xl border border-border-strong bg-surface/50 px-8 py-16 text-center sm:px-16">
          <div aria-hidden className="glow-blue pointer-events-none absolute inset-0 opacity-80" />
          <div
            aria-hidden
            className="grid-bg pointer-events-none absolute inset-0 opacity-[0.25] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_30%,transparent_80%)]"
          />

          <div className="relative">
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
              See your first error in minutes.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-balance text-muted-foreground">
              No credit card. Free plan for side projects. Open source if you want to self-host.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
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
                className="inline-flex items-center rounded-full border border-border bg-background px-5 py-2.5 text-sm text-foreground hover:bg-surface"
              >
                Browse docs
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
