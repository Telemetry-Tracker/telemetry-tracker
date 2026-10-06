import Link from "next/link";
import { ContactEmailLink } from "@/app/components/legal/ContactEmailLink";
import { LegalArticle, LegalSection } from "@/app/components/legal/LegalPageShell";
import { Footer } from "@/app/components/marketing/footer";
import { Nav } from "@/app/components/marketing/nav";
import {
  AFFILIATE_COMMISSION_HOLD_DAYS,
  AFFILIATE_COMMISSION_PERCENT,
  AFFILIATE_PAYOUT_MINIMUM_LABEL,
  AFFILIATE_REFERRAL_WINDOW_DAYS,
  AFFILIATE_TERMS_UPDATED,
  AFFILIATE_TERMS_VERSION,
} from "@/lib/affiliate-program";
import { HOSTED_OPERATOR } from "@/lib/hosted-cloud";

const pct = `${AFFILIATE_COMMISSION_PERCENT}%`;

export const AFFILIATE_TERMS_SECTIONS = [
  { id: "overview", title: "1. Overview" },
  { id: "commission", title: `2. ${pct} recurring commission` },
  { id: "eligible-revenue", title: "3. Eligible revenue" },
  { id: "attribution", title: "4. Referral window and attribution" },
  { id: "self-referrals", title: "5. No self-referrals" },
  { id: "promotion", title: "6. How you may promote" },
  { id: "reversals", title: "7. Refunds, chargebacks, and disputes" },
  { id: "payouts", title: "8. Hold, minimum, and payouts" },
  { id: "good-standing", title: "9. Good standing, abuse, and removal" },
  { id: "changes", title: "10. Changes to these terms" },
  { id: "contact", title: "11. Contact" },
] as const;

const title = (id: (typeof AFFILIATE_TERMS_SECTIONS)[number]["id"]) =>
  AFFILIATE_TERMS_SECTIONS.find((s) => s.id === id)!.title;

export function AffiliateTermsContent({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav isAuthenticated={isAuthenticated} />
      <main id="main-content" className="marketing-main-offset pt-32">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-12 lg:grid-cols-[220px_1fr]">
            <aside className="lg:sticky lg:top-28 lg:self-start">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">On this page</p>
              <nav aria-label="Affiliate terms sections" className="mt-4 space-y-1 border-l border-border">
                {AFFILIATE_TERMS_SECTIONS.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className="-ml-px block border-l border-transparent py-1 pl-4 text-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    {s.title}
                  </a>
                ))}
              </nav>
            </aside>

            <LegalArticle
              eyebrow="Affiliate program"
              title="Affiliate terms"
              updated={`${AFFILIATE_TERMS_UPDATED} (version ${AFFILIATE_TERMS_VERSION})`}
            >
              <div className="max-w-2xl rounded-2xl border border-border bg-surface/40 p-6 text-sm leading-relaxed text-muted-foreground">
                <p className="text-foreground">
                  <span className="font-medium">Short version.</span> Earn {pct} of hosted Pro and
                  Business subscription revenue from customers you refer, for as long as they keep
                  paying and you play fair. No self-referrals, no brand-keyword ads, no spam.
                  Refunds and chargebacks reverse commissions. Payouts are manual once you reach{" "}
                  {AFFILIATE_PAYOUT_MINIMUM_LABEL}.
                </p>
              </div>

              <div className="mt-12">
                <LegalSection id="overview" title={title("overview")} first>
                  <p>
                    These affiliate terms (&quot;Terms&quot;) apply to the Telemetry Tracker
                    affiliate program run by {HOSTED_OPERATOR}, the operator of the hosted cloud at
                    telemetry-tracker.com (&quot;we&quot;, &quot;us&quot;). By applying, you
                    (&quot;affiliate&quot;) accept these Terms. Joining requires our approval; we
                    may decline any application.
                  </p>
                  <p>
                    These Terms sit alongside our general{" "}
                    <Link href="/terms" className="text-brand hover:underline">Terms of Service</Link>{" "}
                    and{" "}
                    <Link href="/privacy" className="text-brand hover:underline">Privacy Policy</Link>.
                    Nothing here makes you our employee, agent, or partner.
                  </p>
                </LegalSection>

                <LegalSection id="commission" title={title("commission")}>
                  <ul>
                    <li>
                      You earn <strong>{pct}</strong> of eligible revenue (section 3) from each
                      organization you refer — on every paid invoice, every month, for as long as
                      that customer keeps paying and you remain in good standing (section 9).
                    </li>
                    <li>
                      Commission is calculated on what the customer actually pays, excluding VAT /
                      sales tax and after any discounts or credits, rounded down to the cent per
                      invoice. Amounts are in EUR.
                    </li>
                    <li>
                      If a referred customer cancels, commission stops with their last paid invoice.
                      If the same organization later resubscribes, you earn on the new invoices
                      again.
                    </li>
                  </ul>
                </LegalSection>

                <LegalSection id="eligible-revenue" title={title("eligible-revenue")}>
                  <ul>
                    <li>
                      Only <strong>hosted Pro and Business subscription</strong> revenue on
                      telemetry-tracker.com is eligible.
                    </li>
                    <li>
                      <strong>Self-hosted revenue never qualifies</strong>, and neither does the Free
                      plan. A referred Free account that upgrades to a paid hosted plan later does
                      qualify from its first paid invoice.
                    </li>
                    <li>
                      Custom or enterprise agreements are not covered unless we agree otherwise in
                      writing.
                    </li>
                  </ul>
                </LegalSection>

                <LegalSection id="attribution" title={title("attribution")}>
                  <ul>
                    <li>
                      A referral counts when a visitor clicks your link (your code in{" "}
                      <code>?ref=</code>) and creates a Telemetry Tracker account within{" "}
                      <strong>{AFFILIATE_REFERRAL_WINDOW_DAYS} days</strong>.
                    </li>
                    <li>
                      <strong>Last touch wins:</strong> if the visitor clicks several affiliate links,
                      the most recent one before signup gets the referral.
                    </li>
                    <li>
                      <strong>Attribution locks at signup.</strong> It is attached to the first
                      organization the referred user creates and does not move to another affiliate
                      later. People who already had an account cannot be attributed.
                    </li>
                    <li>
                      We track referrals with a first-party marker only — no fingerprinting. A
                      visitor&apos;s privacy choices (for example declining optional cookies) can
                      limit tracking to the same browser session. Our records decide attribution.
                    </li>
                  </ul>
                </LegalSection>

                <LegalSection id="self-referrals" title={title("self-referrals")}>
                  <p>
                    You may not refer yourself, your own accounts or organizations, or accounts you
                    create or control on someone else&apos;s behalf. Self-referrals earn no
                    commission, and attempts to disguise them (for example email aliases) are
                    treated as abuse under section 9.
                  </p>
                </LegalSection>

                <LegalSection id="promotion" title={title("promotion")}>
                  <ul>
                    <li>
                      <strong>No brand-keyword bidding.</strong> Do not bid on &quot;Telemetry
                      Tracker&quot;, &quot;TelemetryTracker&quot;, &quot;telemetry-tracker&quot;,
                      telemetry-tracker.com, or misspellings and variants of them in paid search /
                      PPC ads, and don&apos;t use them in ad display URLs.
                    </li>
                    <li>
                      <strong>No spam.</strong> No unsolicited bulk email or DMs, comment or forum
                      spam, or other unwanted messaging.
                    </li>
                    <li>
                      <strong>No misleading claims.</strong> Describe Telemetry Tracker accurately.
                      Don&apos;t invent discounts, features, or guarantees, and don&apos;t present
                      yourself as Telemetry Tracker or {HOSTED_OPERATOR}.
                    </li>
                    <li>
                      Disclose that you earn a commission wherever the law or the platform you
                      publish on requires it.
                    </li>
                  </ul>
                </LegalSection>

                <LegalSection id="reversals" title={title("reversals")}>
                  <p>
                    <strong>Refunds, chargebacks, and disputes reverse commissions.</strong> If a
                    referred payment is refunded or disputed, the related commission is reduced or
                    cancelled. If it was already paid out, the amount is deducted from your future
                    payouts. A commission under open dispute is not payable until the dispute is
                    resolved.
                  </p>
                </LegalSection>

                <LegalSection id="payouts" title={title("payouts")}>
                  <ul>
                    <li>
                      Each commission is held for <strong>{AFFILIATE_COMMISSION_HOLD_DAYS} days</strong>{" "}
                      after the invoice is paid before it becomes payable.
                    </li>
                    <li>
                      We pay out once your payable balance is at least{" "}
                      <strong>{AFFILIATE_PAYOUT_MINIMUM_LABEL}</strong>. Smaller balances roll over.
                    </li>
                    <li>
                      <strong>Payouts are manual</strong> for now. We&apos;ll confirm payout details
                      with you by email and may ask for information we need to pay you lawfully.
                    </li>
                    <li>You are responsible for your own taxes on commissions you receive.</li>
                  </ul>
                </LegalSection>

                <LegalSection id="good-standing" title={title("good-standing")}>
                  <p>
                    You must stay in good standing: follow these Terms and the law, and promote
                    Telemetry Tracker honestly. If we reasonably believe you have engaged in fraud,
                    abuse, self-referrals, spam, brand-keyword bidding, or another breach of these
                    Terms, we may suspend or remove you from the program, and{" "}
                    <strong>you forfeit any unpaid commission</strong>.
                  </p>
                </LegalSection>

                <LegalSection id="changes" title={title("changes")}>
                  <p>
                    We may change these Terms or the program. We&apos;ll give notice of material
                    changes — by email to approved affiliates and by updating the date at the top of
                    this page — before they take effect. Continuing to participate after a change
                    takes effect means you accept it.
                  </p>
                </LegalSection>

                <LegalSection id="contact" title={title("contact")}>
                  <p>
                    Questions about these Terms or a referral? Email{" "}
                    <ContactEmailLink /> or use the{" "}
                    <Link href="/contact" className="text-brand hover:underline">contact page</Link>.
                    Ready to join?{" "}
                    <Link href="/affiliates#apply" className="text-brand hover:underline">
                      Apply on the affiliate program page
                    </Link>
                    .
                  </p>
                </LegalSection>
              </div>
            </LegalArticle>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
