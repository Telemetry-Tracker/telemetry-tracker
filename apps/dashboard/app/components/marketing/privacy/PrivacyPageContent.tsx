import Link from "next/link";
import type { ReactNode } from "react";
import { ContactEmailLink } from "@/app/components/legal/ContactEmailLink";
import { Footer } from "@/app/components/marketing/footer";
import { Nav } from "@/app/components/marketing/nav";
import { HOSTED_DASHBOARD_URL, HOSTED_OPERATOR } from "@/lib/hosted-cloud";

const EFFECTIVE = "July 2, 2026";
const VERSION = "2026.07";

const principles = [
  {
    title: "Minimum by design",
    body: "The product stores observability data you send — not ad profiles, social graphs, or unrelated tracking.",
  },
  {
    title: "You control storage",
    body: "When you self-host, telemetry lives in PostgreSQL on infrastructure you operate. You decide region, access, and retention.",
  },
  {
    title: "Secure deployment",
    body: "Use TLS at your edge, protect API keys, and hash dashboard passwords. Production guidance is in the project docs.",
  },
  {
    title: "No resale of telemetry",
    body: "We do not sell Customer Data. Your operator is responsible for lawful collection from end users.",
  },
];

const dataTable = [
  {
    kind: "Account data",
    examples: "Email, hashed password, organization name, role.",
    purpose: "Authenticate dashboard users and enforce access control.",
    retention: "Lifetime of account; deleted when you remove the user or org.",
  },
  {
    kind: "Customer telemetry",
    examples: "Events, errors, sessions, release tags, custom properties you define.",
    purpose: "Provide observability to your team.",
    retention: "Plan-defined (14–365 days on default tiers) when the retention job runs.",
  },
  {
    kind: "Billing data",
    examples: "Stripe customer id, subscription status, plan tier (when Stripe is enabled).",
    purpose: "Process payments and enforce plan limits.",
    retention: "While billing is active; governed by your Stripe configuration.",
  },
  {
    kind: "Support correspondence",
    examples: "Emails or messages you send to the project maintainers.",
    purpose: "Answer questions and improve documentation.",
    retention: "As long as needed to resolve the request.",
  },
  {
    kind: "Marketing / product updates",
    examples: "Email address, consent timestamp, subscribe source (footer or registration).",
    purpose: "Send optional release notes and feature announcements on the Hosted Cloud.",
    retention: "Until you unsubscribe via the link in our emails.",
  },
];

const optionalServices = [
  { name: "Stripe", role: "Optional payment processing", note: "When configured on the API" },
  { name: "Resend", role: "Optional transactional email", note: "Invites, password reset, contact, product updates" },
  { name: "Sentry", role: "Optional error monitoring", note: "When SENTRY_DSN is set on the API and/or dashboard" },
];

const rights = [
  "Access personal data your operator holds about you",
  "Correct inaccurate account information",
  "Delete your dashboard account",
  "Export telemetry stored in your deployment",
  "Object to or restrict certain processing, where applicable law provides",
  "Lodge a complaint with your supervisory authority",
];

const toc: { id: string; label: string }[] = [
  { id: "hosted-cloud", label: "Hosted cloud" },
  { id: "controller", label: "1. Who processes data" },
  { id: "what", label: "2. What we collect" },
  { id: "legal", label: "3. Legal basis" },
  { id: "sharing", label: "4. Sharing" },
  { id: "subprocessors", label: "5. Optional third parties" },
  { id: "transfers", label: "6. Where data lives" },
  { id: "retention", label: "7. Retention" },
  { id: "security", label: "8. Security" },
  { id: "rights", label: "9. Your rights" },
  { id: "children", label: "10. Children" },
  { id: "changes", label: "11. Changes" },
  { id: "contact", label: "12. Contact" },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function PrivacyPageContent() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />

      <main id="main-content" className="pt-32">
        <section className="relative overflow-hidden border-b border-border">
          <div aria-hidden className="glow-blue absolute inset-0 opacity-50" />
          <div aria-hidden className="grid-bg absolute inset-0 opacity-[0.3]" />
          <div className="relative mx-auto max-w-6xl px-6 py-20">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Legal</p>
            <h1 className="mt-4 max-w-3xl text-balance text-5xl font-semibold tracking-tight md:text-6xl">
              Privacy Policy
            </h1>
            <p className="mt-5 max-w-2xl text-balance text-base text-muted-foreground md:text-lg">
              How Telemetry Tracker handles personal data when you self-host or use the official
              hosted cloud at telemetry-tracker.com. Written so an engineer can audit it in one
              sitting.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
              <span className="rounded-full border border-border bg-surface/70 px-3 py-1 backdrop-blur">
                Effective {EFFECTIVE}
              </span>
              <span className="rounded-full border border-border bg-surface/70 px-3 py-1 backdrop-blur">
                Version {VERSION}
              </span>
              <span className="rounded-full border border-border bg-surface/70 px-3 py-1 backdrop-blur">
                Self-hosted & hosted cloud
              </span>
            </div>
          </div>
        </section>

        <section className="border-b border-border">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Operating principles
            </p>
            <div className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2">
              {principles.map((p) => (
                <div key={p.title} className="bg-background p-6">
                  <h3 className="text-base font-medium text-foreground">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-12 lg:grid-cols-[220px_1fr]">
            <aside className="lg:sticky lg:top-28 lg:self-start">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                On this page
              </p>
              <nav className="mt-4 space-y-1 border-l border-border">
                {toc.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="-ml-px block border-l border-transparent py-1 pl-4 text-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </aside>

            <article className="max-w-3xl">
              <div className="rounded-2xl border border-border bg-surface/40 p-6 text-sm leading-relaxed text-muted-foreground">
                <p className="text-foreground">
                  <span className="font-medium">In short.</span> Self-hosted deployments are
                  controlled by your operator. On the official Hosted Cloud at{" "}
                  <a href={HOSTED_DASHBOARD_URL} className="underline-offset-4 hover:underline">
                    telemetry-tracker.com
                  </a>
                  , {HOSTED_OPERATOR} processes dashboard account data and stores Customer Data in
                  managed infrastructure. This page describes what the product can process — it does
                  not replace your privacy notices to end users.
                </p>
              </div>

              <div className="mt-12 space-y-14 text-[15px] leading-relaxed text-muted-foreground">
                <Section id="hosted-cloud" title="Official hosted cloud">
                  <p>
                    When you register at{" "}
                    <a href={HOSTED_DASHBOARD_URL} className="text-foreground/85 hover:text-foreground">
                      {HOSTED_DASHBOARD_URL.replace("https://", "")}
                    </a>
                    , {HOSTED_OPERATOR} is the data controller for your dashboard account (email,
                    hashed password, organization membership) and processor of Customer Data you send
                    through ingest (errors, events, sessions, source maps).
                  </p>
                  <p>
                    Data is stored in managed PostgreSQL and object storage operated for the Hosted
                    Cloud. Retention follows your plan tier and runs on a scheduled job. Billing uses
                    Stripe; transactional email (invites, password reset, contact form, optional
                    product updates) may use Resend when configured.
                  </p>
                  <p>
                    Privacy requests for Hosted Cloud accounts:{" "}
                    <ContactEmailLink className="text-foreground/85 hover:text-foreground" />.
                  </p>
                </Section>

                <Section id="controller" title="1. Who processes data">
                  <p>
                    When you run Telemetry Tracker on your own infrastructure,{" "}
                    <span className="text-foreground/85">you or your organization</span> is typically
                    the data controller for dashboard accounts and telemetry stored in your database.
                    When you capture data from your application&apos;s end users, you are the
                    controller of that telemetry; the software acts as a tool under your
                    instructions.
                  </p>
                  <p>
                    Questions about the open-source project itself can be sent to{" "}
                    <ContactEmailLink className="text-foreground/85 hover:text-foreground" />.
                  </p>
                </Section>

                <Section id="what" title="2. What we collect">
                  <p>
                    The product can process four categories of data. What actually lands in your
                    database depends on how you configure SDKs, ingest, and billing.
                  </p>
                  <div className="mt-5 overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-surface/60">
                        <tr className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          <th className="px-4 py-3 font-medium">Category</th>
                          <th className="px-4 py-3 font-medium">Examples</th>
                          <th className="hidden px-4 py-3 font-medium md:table-cell">Purpose</th>
                          <th className="hidden px-4 py-3 font-medium lg:table-cell">Retention</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {dataTable.map((row) => (
                          <tr key={row.kind} className="align-top">
                            <td className="px-4 py-4 text-foreground">{row.kind}</td>
                            <td className="px-4 py-4">{row.examples}</td>
                            <td className="hidden px-4 py-4 md:table-cell">{row.purpose}</td>
                            <td className="hidden px-4 py-4 font-mono text-xs lg:table-cell">
                              {row.retention}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-5">
                    SDK payloads may include stack traces, custom properties, session identifiers,
                    and user ids when you attach them. Avoid sending secrets, payment data, or
                    unnecessary personal data in events and breadcrumbs.
                  </p>
                </Section>

                <Section id="legal" title="3. Legal basis">
                  <p>
                    If GDPR or similar law applies, your operator typically relies on:
                  </p>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5">
                    <li>
                      <span className="text-foreground/85">Contract</span> — to provide the
                      observability service to your team.
                    </li>
                    <li>
                      <span className="text-foreground/85">Legitimate interest</span> — to secure
                      and operate the deployment.
                    </li>
                    <li>
                      <span className="text-foreground/85">Legal obligation</span> — for tax,
                      accounting, or lawful requests where billing is enabled.
                    </li>
                    <li>
                      <span className="text-foreground/85">Consent</span> — where required for
                      optional features you enable, including product update emails when you
                      subscribe on the marketing site or opt in during registration.
                    </li>
                  </ul>
                </Section>

                <Section id="sharing" title="4. Sharing">
                  <p>
                    We do not sell personal data. On a self-hosted deployment, telemetry is not
                    shared with us unless you include reproduction details in support correspondence.
                    On the Hosted Cloud, {HOSTED_OPERATOR} uses subprocessors (for example Stripe,
                    Resend, and infrastructure providers) only to operate the service — see Section
                    5.
                  </p>
                </Section>

                <Section id="subprocessors" title="5. Third-party services">
                  <p>
                    Self-hosted and Hosted Cloud deployments may call external services when
                    configured:
                  </p>
                  <div className="mt-5 overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-surface/60">
                        <tr className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          <th className="px-4 py-3 font-medium">Service</th>
                          <th className="px-4 py-3 font-medium">Role</th>
                          <th className="hidden px-4 py-3 font-medium md:table-cell">When used</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {optionalServices.map((s) => (
                          <tr key={s.name}>
                            <td className="px-4 py-3 text-foreground">{s.name}</td>
                            <td className="px-4 py-3">{s.role}</td>
                            <td className="hidden px-4 py-3 md:table-cell">{s.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-5">
                    Review each vendor&apos;s terms and data processing agreements before enabling
                    them in production.
                  </p>
                </Section>

                <Section id="transfers" title="6. Where data lives">
                  <p>
                    Self-hosted: data residency is determined by where you deploy PostgreSQL and
                    the dashboard. Hosted Cloud: Customer Data and account data are stored in
                    infrastructure selected by {HOSTED_OPERATOR} for the managed service. Optional
                    third-party services may process data in their own regions — configure them only
                    if that meets your compliance requirements.
                  </p>
                </Section>

                <Section id="retention" title="7. Retention">
                  <p>
                    Plan tiers define retention windows (14 days on Free, 90 on Pro, 365 on Business).
                    A scheduled retention job deletes telemetry older than your effective plan limit.
                    Self-hosters can also delete projects, rotate API keys, and purge rows directly.
                    On the Hosted Cloud, {HOSTED_OPERATOR} runs retention on your behalf.
                  </p>
                  <p>
                    Self-hosters must schedule the retention job in production — without it,
                    telemetry grows until manual cleanup. See the deployment docs for cron setup.
                  </p>
                </Section>

                <Section id="security" title="8. Security">
                  <ul className="mt-2 list-disc space-y-1.5 pl-5">
                    <li>Terminate TLS at your reverse proxy or load balancer.</li>
                    <li>Dashboard passwords are stored hashed; ingest requires project API keys.</li>
                    <li>
                      Disable unauthenticated ingest and open registration in production when
                      appropriate.
                    </li>
                    <li>Store secrets in your platform secret manager, not in git.</li>
                    <li>
                      Report vulnerabilities via{" "}
                      <a
                        href="https://github.com/Telemetry-Tracker/telemetry-tracker/security/advisories/new"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-foreground/85 hover:text-foreground"
                      >
                        GitHub security advisories
                      </a>
                      .
                    </li>
                  </ul>
                </Section>

                <Section id="rights" title="9. Your rights">
                  <p>Subject to your jurisdiction and your operator&apos;s policies, you may have the right to:</p>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5">
                    {rights.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <p className="mt-4">
                    For a deployment you operate, use dashboard settings and database access. For
                    questions about the open-source project, contact{" "}
                    <ContactEmailLink className="text-foreground/85 hover:text-foreground" />.
                  </p>
                </Section>

                <Section id="children" title="10. Children">
                  <p>
                    The Service is not directed to anyone under 16. Operators should not knowingly
                    collect personal data from children through telemetry payloads. If you believe
                    such data was collected, delete it from your deployment and contact{" "}
                    <ContactEmailLink className="text-foreground/85 hover:text-foreground" /> if you
                    need guidance.
                  </p>
                </Section>

                <Section id="changes" title="11. Changes">
                  <p>
                    Material changes to this policy are reflected on this page with an updated
                    effective date. Your operator may also maintain separate notices for end users
                    of applications instrumented with Telemetry Tracker.
                  </p>
                </Section>

                <Section id="contact" title="12. Contact">
                  <p>
                    Privacy questions about the open-source project:{" "}
                    <ContactEmailLink className="text-foreground/85 hover:text-foreground" /> or the{" "}
                    <Link href="/contact" className="text-foreground/85 hover:text-foreground">
                      contact page
                    </Link>
                    . Questions about data in a specific deployment should go to that deployment&apos;s
                    operator.
                  </p>
                </Section>
              </div>

              <div className="mt-16 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface/40 p-6">
                <div>
                  <p className="text-sm font-medium text-foreground">Running in production?</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    See the production readiness checklist for retention, auth, and HTTPS.
                  </p>
                </div>
                <Link
                  href="/docs"
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.02]"
                >
                  Read the docs
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M3 8h10M9 4l4 4-4 4" />
                  </svg>
                </Link>
              </div>
            </article>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
