import Link from "next/link";
import { SectionHeading } from "./features";
import { formatPlanPriceEur, PLAN_LIST_PRICES_EUR } from "@/lib/plan-pricing";

const tiers = [
  {
    name: "Free",
    price: formatPlanPriceEur(PLAN_LIST_PRICES_EUR.FREE),
    cadence: "forever",
    desc: "For solo developers and side projects.",
    cta: "Start free",
    signup: true,
    features: [
      "250K ingest units / month",
      "14-day retention",
      "1 project · 2 API keys",
      "Community support",
    ],
  },
  {
    name: "Pro",
    price: formatPlanPriceEur(PLAN_LIST_PRICES_EUR.PRO),
    cadence: "per org / month",
    desc: "For shipping teams that need reliable signal.",
    cta: "Start free, upgrade later",
    signup: true,
    highlight: true,
    features: [
      "5M ingest units / month",
      "90-day retention",
      "Up to 10 projects",
      "Stripe billing (EUR)",
      "Priority email support",
    ],
  },
  {
    name: "Business",
    price: formatPlanPriceEur(PLAN_LIST_PRICES_EUR.BUSINESS),
    cadence: "per org / month",
    desc: "For organizations with higher volume and longer retention.",
    cta: "Start free, upgrade later",
    signup: true,
    features: [
      "50M ingest units / month",
      "365-day retention",
      "Up to 50 projects",
      "Stripe billing (EUR)",
      "Dedicated support",
    ],
  },
  {
    name: "Custom",
    price: "Let's talk",
    cadence: "annual or bespoke",
    desc: "Enterprise volume, compliance, or on-prem requirements.",
    cta: "Contact us",
    href: "/contact",
    features: [
      "Custom ingest & retention",
      "Multiple organizations",
      "Custom SLA options",
      "Security review support",
      "Dedicated onboarding",
    ],
  },
];

export function Pricing({
  isAuthenticated = false,
  headingLevel = "h2",
}: {
  isAuthenticated?: boolean;
  headingLevel?: "h1" | "h2";
}) {
  return (
    <section id="pricing" className="relative scroll-mt-28 py-28">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="Pricing"
          headingLevel={headingLevel}
          title={<>Honest pricing that scales with your traffic.</>}
          subtitle="All prices in EUR. Ingest stops at your plan cap — never a surprise bill."
        />
        <div className="mx-auto mt-8 max-w-2xl space-y-3 text-left text-sm leading-relaxed text-muted-foreground">
          <p>
            An ingest unit is one accepted telemetry item: one event, one item inside a batch, one
            error, or one session. A calendar month is the quota window.
          </p>
          <p>
            At the cap, new ingest is rejected with HTTP 429 (<code>monthly_ingest_quota</code>)
            until the next month or a higher plan. Stored data stays for the plan retention window.
            There is no overage charge.
          </p>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiers.map((t) => {
            const ctaClassName = `mt-6 inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition-transform hover:scale-[1.01] ${
              t.highlight
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-background text-foreground hover:bg-surface"
            }`;

            return (
              <div
                key={t.name}
                className={`relative flex flex-col rounded-2xl border p-7 ${
                  t.highlight
                    ? "border-border-strong bg-surface-elevated"
                    : "border-border bg-surface/40"
                }`}
              >
                {t.highlight ? (
                  <span className="absolute -top-2.5 left-7 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] text-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                    Most popular
                  </span>
                ) : null}
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[15px] font-medium tracking-tight">{t.name}</h3>
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="tabular text-4xl font-semibold tracking-tight">{t.price}</span>
                  <span className="text-sm text-muted-foreground">{t.cadence}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{t.desc}</p>

                {t.signup ? (
                  <Link
                    href={isAuthenticated ? "/dashboard/overview" : "/register"}
                    className={ctaClassName}
                  >
                    {isAuthenticated ? "Open dashboard" : t.cta}
                  </Link>
                ) : (
                  <Link href={t.href!} className={ctaClassName}>
                    {t.cta}
                  </Link>
                )}

                <ul className="mt-7 space-y-2.5 text-sm">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-foreground/90">
                      <svg
                        viewBox="0 0 16 16"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 8.5 6.5 12 13 4.5" />
                      </svg>
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
