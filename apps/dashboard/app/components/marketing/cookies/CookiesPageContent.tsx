import Link from "next/link";
import type { ReactNode } from "react";
import { ContactEmailLink } from "@/app/components/legal/ContactEmailLink";
import { Footer } from "@/app/components/marketing/footer";
import { Nav } from "@/app/components/marketing/nav";
import { COOKIE_CONSENT_STORAGE_KEY } from "@/lib/cookie-consent";

const EFFECTIVE = "July 3, 2026";

type Row = {
  name: string;
  purpose: string;
  type: "Essential" | "Preferences" | "Analytics";
  retention: string;
};

const rows: Row[] = [
  {
    name: COOKIE_CONSENT_STORAGE_KEY,
    purpose: "Remembers your accept / reject choice for optional storage.",
    type: "Essential",
    retention: "12 months (localStorage + cookie)",
  },
  {
    name: "telemetry_session",
    purpose: "Keeps you signed in to the dashboard between page loads.",
    type: "Essential",
    retention: "30 days",
  },
  {
    name: "telemetry_organization_id",
    purpose: "Remembers the organization the dashboard must send with API requests.",
    type: "Essential",
    retention: "Up to 400 days",
  },
  {
    name: "telemetry_project_id",
    purpose: "Remembers the project the dashboard must send with API requests.",
    type: "Essential",
    retention: "Up to 400 days",
  },
  {
    name: "_ga / _ga_*",
    purpose: "Google Analytics — page views and traffic on the marketing site (hosted cloud only, when you accept cookies).",
    type: "Analytics",
    retention: "Up to 2 years (Google)",
  },
];

const sections = [
  { id: "what", label: "What cookies are" },
  { id: "use", label: "How we use them" },
  { id: "table", label: "Cookies we set" },
  { id: "control", label: "Your choices" },
  { id: "third", label: "Third parties" },
  { id: "contact", label: "Contact" },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function CookiesPageContent() {
  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] glow-blue opacity-60" />
      <Nav />

      <main
        id="main-content"
        className="marketing-main-offset relative mx-auto w-full min-w-0 max-w-6xl px-6 pb-24 pt-36"
      >
        <header className="max-w-3xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            Last updated · {EFFECTIVE}
          </p>
          <h1 className="mt-6 text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
            Cookie policy
          </h1>
          <p className="mt-5 max-w-2xl text-base text-muted-foreground">
            We keep cookies to the minimum required to run Telemetry Tracker. Anything beyond
            strictly necessary storage waits for your consent where applicable.
          </p>
        </header>

        <div className="mt-16 grid min-w-0 gap-12 lg:grid-cols-[220px_1fr]">
          <aside className="hidden lg:block">
            <div className="sticky top-28">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                On this page
              </p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="text-foreground/80 transition-colors hover:text-foreground"
                    >
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <article className="min-w-0 max-w-3xl space-y-12 break-words text-[15px] leading-7 text-muted-foreground">
            <div className="max-w-full rounded-2xl border border-border bg-surface/60 p-5">
              <p className="text-xs uppercase tracking-[0.16em] text-foreground">In short</p>
              <p className="mt-2 break-words text-foreground/85">
                Essential cookies always run — they sign you in, remember the selected
                organization and project, and store your consent choice. Optional analytics
                (Google Analytics on the official hosted site) load only when you accept in the banner.
              </p>
            </div>

            <Section id="what" title="What cookies are">
              <p>
                Cookies are small text files stored by your browser. We also use equivalent storage
                like{" "}
                <code className="font-mono text-foreground">localStorage</code> for the same
                purposes. Throughout this page, &quot;cookies&quot; refers to both.
              </p>
            </Section>

            <Section id="use" title="How we use them">
              <p>
                We use cookies to keep you signed in, remember your dashboard workspace, and record
                your cookie banner choice. When you accept optional cookies on{" "}
                <Link
                  href="https://telemetry-tracker.com"
                  className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  telemetry-tracker.com
                </Link>
                , we also load Google Analytics to understand marketing traffic — not for
                advertising. When you self-host, your operator controls which cookies are set on
                your deployment.
              </p>
            </Section>

            <section id="table" className="scroll-mt-28">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                Cookies we set
              </h2>

              <div className="mt-6 space-y-3 md:hidden">
                {rows.map((r) => (
                  <div
                    key={r.name}
                    className="rounded-xl border border-border bg-surface/40 p-4"
                  >
                    <p className="font-mono text-xs text-foreground">{r.name}</p>
                    <p className="mt-2 text-sm text-foreground/85">{r.purpose}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-foreground">
                        {r.type}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{r.retention}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 hidden overflow-x-auto rounded-xl border border-border md:block">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-surface/60">
                    <tr className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      <th className="px-4 py-3 font-normal">Name</th>
                      <th className="px-4 py-3 font-normal">Purpose</th>
                      <th className="px-4 py-3 font-normal">Type</th>
                      <th className="hidden px-4 py-3 font-normal lg:table-cell">Retention</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                      <tr key={r.name} className="align-top">
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{r.name}</td>
                        <td className="px-4 py-3 text-foreground/85">{r.purpose}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-foreground">
                            {r.type}
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 font-mono text-xs lg:table-cell">
                          {r.retention}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <Section id="control" title="Your choices">
              <p>
                You can accept or reject optional storage in the banner that appears on your first
                visit. You can also clear your browser storage at any time to be re-prompted. Most
                browsers let you block cookies entirely — doing so may break dashboard sign-in.
              </p>
            </Section>

            <Section id="third" title="Third parties">
              <p>
                On the official hosted site, Google Analytics loads only after you accept cookies in
                the banner. We do not embed advertising or social trackers. If you enable optional
                services on a self-hosted deployment (for example Stripe or Resend), those vendors
                may set cookies strictly to deliver their service — see our{" "}
                <Link
                  href="/privacy"
                  className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  privacy policy
                </Link>
                .
              </p>
            </Section>

            <Section id="contact" title="Contact">
              <p>
                Questions about cookies? Use the{" "}
                <Link
                  href="/contact"
                  className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  contact page
                </Link>{" "}
                or email <ContactEmailLink className="text-foreground/85 hover:text-foreground" />.
              </p>
            </Section>
          </article>
        </div>
      </main>

      <Footer />
    </div>
  );
}
