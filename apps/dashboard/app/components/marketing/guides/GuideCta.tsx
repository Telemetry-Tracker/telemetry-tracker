import Link from "next/link";
import { MarketingNavLink } from "@/app/components/marketing/MarketingNavLink";

export function GuideCta({
  heading = "Start tracking errors for free",
  body = "No credit card. Create a project, install the SDK, and the first error shows up in Issues.",
}: {
  heading?: string;
  body?: string;
}) {
  return (
    <section className="not-prose mt-14 rounded-2xl border border-border-strong bg-surface/50 p-6 sm:p-8">
      <h2 className="text-xl font-semibold tracking-tight">{heading}</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <MarketingNavLink
          href="/register"
          pendingLabel="Loading…"
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.02]"
        >
          Start free
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
          href="/docs/hosted-cloud"
          className="inline-flex items-center rounded-full border border-border bg-background px-5 py-2.5 text-sm text-foreground hover:bg-surface"
        >
          Hosted cloud guide
        </Link>
      </div>
    </section>
  );
}
