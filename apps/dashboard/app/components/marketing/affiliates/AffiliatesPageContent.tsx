import Link from "next/link";
import type { ReactNode } from "react";
import { Footer } from "@/app/components/marketing/footer";
import { Nav } from "@/app/components/marketing/nav";
import { AffiliateApplicationForm } from "@/app/components/marketing/affiliates/AffiliateApplicationForm";
import {
  AFFILIATE_COMMISSION_HOLD_DAYS,
  AFFILIATE_COMMISSION_PERCENT,
  AFFILIATE_EARNING_EXAMPLES,
  AFFILIATE_ELIGIBLE_PLAN_TIERS,
  AFFILIATE_PAYOUT_MINIMUM_LABEL,
  AFFILIATE_PLAN_LABELS,
  AFFILIATE_REFERRAL_WINDOW_DAYS,
  commissionPerInvoiceCents,
  formatEurCents,
  planMonthlyPriceCents,
} from "@/lib/affiliate-program";

const pct = `${AFFILIATE_COMMISSION_PERCENT}%`;

const audiences = [
  {
    title: "Developers",
    desc: "You already tell friends and colleagues what you use. Share the link when you do.",
  },
  {
    title: "Technical creators & bloggers",
    desc: "Tutorials on Next.js, React, Node.js, or debugging production errors fit naturally.",
  },
  {
    title: "Newsletter authors",
    desc: "A tools mention or a sponsored-style write-up for your dev-focused readers.",
  },
  {
    title: "YouTubers & streamers",
    desc: "Setup walkthroughs, ‘Sentry alternatives’ comparisons, and build-in-public videos.",
  },
  {
    title: "Open-source maintainers",
    desc: "Recommend error tracking in your README, docs, or starter templates.",
  },
  {
    title: "Consultants & agencies",
    desc: "Set clients up on hosted Telemetry Tracker and keep earning while they stay.",
  },
];

const steps: { title: string; body: ReactNode }[] = [
  {
    title: "Apply",
    body: "Tell us who you are and where you’ll recommend Telemetry Tracker. No account needed. We review every application by hand.",
  },
  {
    title: "Share your link",
    body: (
      <>
        Approved affiliates get a personal code. Add <code>?ref=yourcode</code> to any page on
        telemetry-tracker.com — the homepage, pricing, docs, or a comparison guide.
      </>
    ),
  },
  {
    title: "Visitors sign up",
    body: `If someone signs up within ${AFFILIATE_REFERRAL_WINDOW_DAYS} days of clicking your link, the signup is yours. The last affiliate link clicked wins, and attribution locks when the account is created.`,
  },
  {
    title: "Earn on every paid invoice",
    body: `You earn ${pct} of every hosted Pro or Business invoice they pay — every month, for as long as they keep paying. Upgrading from Free later still counts.`,
  },
  {
    title: "Get paid",
    body: `Each commission is held for ${AFFILIATE_COMMISSION_HOLD_DAYS} days (refund and chargeback window). Once your payable balance reaches ${AFFILIATE_PAYOUT_MINIMUM_LABEL}, we pay it out manually.`,
  },
];

const rules: ReactNode[] = [
  <>
    <strong>{pct} recurring</strong> on eligible hosted subscription revenue — every invoice, for as
    long as the referred customer keeps paying and you stay in good standing.
  </>,
  <>
    <strong>Eligible:</strong> hosted Pro and Business plans only. Self-hosted usage never earns
    commission, and the Free plan earns nothing until it converts to paid.
  </>,
  <>
    <strong>{AFFILIATE_REFERRAL_WINDOW_DAYS}-day, last-touch window.</strong> The most recent
    affiliate link before signup gets the credit. Attribution locks at signup and never moves to
    another affiliate later.
  </>,
  <>
    <strong>Free → paid counts.</strong> If a referred account upgrades months after signing up,
    you still earn on its paid invoices.
  </>,
  <>
    <strong>Existing accounts don&apos;t count.</strong> People who already had an account before
    clicking your link can&apos;t be attributed.
  </>,
  <>
    <strong>No self-referrals.</strong> Signing yourself or your own organization up through your
    link earns nothing.
  </>,
  <>
    <strong>{AFFILIATE_COMMISSION_HOLD_DAYS}-day hold, {AFFILIATE_PAYOUT_MINIMUM_LABEL} minimum.</strong>{" "}
    Refunds, chargebacks, and lost disputes reverse the related commission. Payouts are manual for
    now.
  </>,
];

const faqs: { q: string; a: ReactNode }[] = [
  {
    q: "What exactly is the commission calculated on?",
    a: `On what the referred organization actually pays for its hosted Pro or Business subscription, excluding VAT / sales tax, and after any discounts or credits. Each invoice earns ${pct}, rounded down to the cent.`,
  },
  {
    q: "Do self-hosted users count?",
    a: "No. Telemetry Tracker is open source and free to self-host — that never earns commission. Only hosted subscription revenue on telemetry-tracker.com qualifies.",
  },
  {
    q: "How long does a referral last?",
    a: `Your link is remembered for up to ${AFFILIATE_REFERRAL_WINDOW_DAYS} days before signup (last click wins). After signup the organization stays attributed to you for as long as it keeps paying.`,
  },
  {
    q: "How does tracking work? Do you fingerprint visitors?",
    a: `No fingerprinting. We use a first-party referral marker: it is kept for the browser session, and only kept for up to ${AFFILIATE_REFERRAL_WINDOW_DAYS} days in a first-party cookie when the visitor accepts optional cookies. Visitors who decline still count if they sign up in the same session.`,
  },
  {
    q: "When and how do I get paid?",
    a: `Commissions become payable ${AFFILIATE_COMMISSION_HOLD_DAYS} days after the invoice is paid. When your payable balance is at least ${AFFILIATE_PAYOUT_MINIMUM_LABEL}, we send a manual payout and confirm the details with you by email.`,
  },
  {
    q: "Can I bid on ‘Telemetry Tracker’ in search ads?",
    a: (
      <>
        No. Bidding on Telemetry Tracker brand keywords (and misspellings or variants) is not
        allowed. See the{" "}
        <Link href="/affiliates/terms" className="text-foreground underline-offset-4 hover:underline">
          affiliate terms
        </Link>{" "}
        for the full list of rules.
      </>
    ),
  },
];

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="mt-1 h-3.5 w-3.5 shrink-0 text-brand"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

export function AffiliatesPageContent({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const stats = [
    { value: pct, label: "recurring commission" },
    { value: `${AFFILIATE_REFERRAL_WINDOW_DAYS} days`, label: "referral window" },
    { value: `${AFFILIATE_COMMISSION_HOLD_DAYS} days`, label: "commission hold" },
    { value: AFFILIATE_PAYOUT_MINIMUM_LABEL, label: "minimum payout" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav isAuthenticated={isAuthenticated} />

      <main id="main-content" className="marketing-main-offset">
        <section className="relative overflow-hidden border-b border-border pt-36 sm:pt-44">
          <div aria-hidden className="glow-blue pointer-events-none absolute inset-0 -z-10 opacity-80" />
          <div
            aria-hidden
            className="grid-bg pointer-events-none absolute inset-0 -z-20 opacity-[0.35] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_30%,#000_30%,transparent_75%)]"
          />
          <div className="mx-auto max-w-5xl px-6 pb-20 text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" />
              Affiliate program
            </p>
            <h1 className="mx-auto mt-7 max-w-4xl text-balance text-3xl font-semibold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl">
              Earn {pct} recurring commission with Telemetry Tracker
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
              Recommend open-source error tracking to developers. When someone you refer pays for a
              hosted Pro or Business plan, you earn {pct} of every invoice — for as long as they
              keep paying.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-2">
              <a
                href="#apply"
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.02]"
              >
                Apply to the program
              </a>
              <Link
                href="/affiliates/terms"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface"
              >
                Read the terms
              </Link>
            </div>

            <dl className="mx-auto mt-14 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="bg-background/90 px-4 py-5">
                  <dt className="text-xs text-muted-foreground">{s.label}</dt>
                  <dd className="tabular mt-1 text-2xl font-semibold tracking-tight">{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="audience-heading" className="mx-auto max-w-6xl px-6 py-24">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Who it&apos;s for</p>
          <h2 id="audience-heading" className="mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            For people developers already trust for tooling advice.
          </h2>
          <ul className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {audiences.map((a) => (
              <li key={a.title} className="bg-background p-6">
                <h3 className="text-base font-medium">{a.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{a.desc}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="earnings-heading" className="border-y border-border bg-surface/30">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">What you can earn</p>
            <h2 id="earnings-heading" className="mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Simple math, paid every month they stay.
            </h2>

            <div className="mt-10 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
              <div className="rounded-2xl border border-border bg-background p-6">
                <h3 className="text-sm font-medium">Per referred customer</h3>
                <table className="mt-4 w-full text-sm">
                  <caption className="sr-only">Monthly commission per referred customer by plan</caption>
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="pb-2 font-normal">Plan</th>
                      <th scope="col" className="pb-2 font-normal">List price</th>
                      <th scope="col" className="pb-2 text-right font-normal">You earn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {AFFILIATE_ELIGIBLE_PLAN_TIERS.map((plan) => (
                      <tr key={plan} className="border-t border-border">
                        <th scope="row" className="py-3 text-left font-medium">
                          {AFFILIATE_PLAN_LABELS[plan]}
                        </th>
                        <td className="tabular py-3 text-muted-foreground">
                          {formatEurCents(planMonthlyPriceCents(plan))} / month
                        </td>
                        <td className="tabular py-3 text-right font-medium">
                          {formatEurCents(commissionPerInvoiceCents(plan))} / month
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="grid gap-4 sm:grid-cols-2">
                {AFFILIATE_EARNING_EXAMPLES.map((ex) => (
                  <li key={ex.id} className="rounded-2xl border border-border bg-background p-6">
                    <p className="text-sm text-muted-foreground">Refer {ex.label}</p>
                    <p className="tabular mt-2 text-3xl font-semibold tracking-tight">
                      {formatEurCents(ex.monthlyCents)}
                      <span className="text-base font-normal text-muted-foreground"> / month</span>
                    </p>
                    <p className="tabular mt-1 text-xs text-muted-foreground">
                      {formatEurCents(ex.yearlyCents)} over a year if they all stay
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-6 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              Examples use today&apos;s <Link href="/pricing" className="underline-offset-4 hover:underline">list prices</Link>.
              Hosted plans are billed monthly (there are no annual plans right now). Commission is{" "}
              {pct} of what the customer actually pays, excluding VAT / sales tax and after discounts
              or credits, rounded down to the cent per invoice. Self-hosted and Free usage never earn
              commission. Refunds and chargebacks reverse the related commission.
            </p>
          </div>
        </section>

        <section aria-labelledby="how-heading" className="mx-auto max-w-6xl px-6 py-24">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">How it works</p>
          <h2 id="how-heading" className="mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            From link to payout.
          </h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-5">
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-2xl border border-border bg-surface/40 p-6">
                <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
                <h3 className="mt-3 text-base font-medium">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground [&_code]:rounded [&_code]:bg-surface-elevated [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="rules-heading" className="border-t border-border">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">The rules</p>
              <h2 id="rules-heading" className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Clear rules, no fine-print surprises.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                The summary on the right is the short version. The{" "}
                <Link href="/affiliates/terms" className="text-foreground underline-offset-4 hover:underline">
                  affiliate terms
                </Link>{" "}
                are the full version you agree to when you apply.
              </p>
            </div>
            <ul className="space-y-4 text-sm leading-relaxed text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
              {rules.map((rule, i) => (
                <li key={i} className="flex gap-3">
                  <CheckIcon />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="apply" aria-labelledby="apply-heading" className="scroll-mt-28 border-t border-border bg-surface/30">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-[1fr_1.3fr]">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Apply</p>
              <h2 id="apply-heading" className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Join the affiliate program.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Takes two minutes. We read every application and get back to approved affiliates by
                email with a personal referral link like{" "}
                <code className="rounded bg-surface-elevated px-1 font-mono text-[12px] text-foreground">
                  telemetry-tracker.com/?ref=yourname
                </code>
                .
              </p>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Questions first?{" "}
                <Link href="/contact" className="text-foreground underline-offset-4 hover:underline">
                  Contact us
                </Link>
                .
              </p>
            </div>
            <div className="relative rounded-2xl border border-border bg-background p-6 sm:p-8">
              <AffiliateApplicationForm />
            </div>
          </div>
        </section>

        <section aria-labelledby="faq-heading" className="border-t border-border">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">FAQ</p>
            <h2 id="faq-heading" className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
              Common questions.
            </h2>
            <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2">
              {faqs.map((f) => (
                <div key={f.q} className="bg-background p-6">
                  <h3 className="text-base font-medium text-foreground">{f.q}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
