"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  submitContactForm,
  type ContactFormInput,
  type ContactTopic,
} from "@/app/contact/actions";
import { Footer } from "@/app/components/marketing/footer";
import { MarketingSubscribeForm } from "@/app/components/marketing/MarketingSubscribeForm";
import { Nav } from "@/app/components/marketing/nav";
import { gmailComposeUrl } from "@/lib/contact-email";
import { authInputClassName } from "@/lib/input-classes";

type ContactValues = ContactFormInput;

const channels = [
  {
    label: "General",
    desc: "Product questions, feedback, and hosted deployments.",
    href: gmailComposeUrl({ subject: "Telemetry Tracker — General inquiry" }),
    detail: "info@tacko.io",
    sla: "Replies within 1 business day",
    external: true,
  },
  {
    label: "Support",
    desc: "SDK integration, ingest issues, and dashboard help.",
    href: gmailComposeUrl({ subject: "Telemetry Tracker — Support" }),
    detail: "info@tacko.io",
    sla: "Community on Free; priority on Pro",
    external: true,
  },
  {
    label: "Security",
    desc: "Responsible disclosure and vulnerability reports.",
    href: "https://github.com/Telemetry-Tracker/telemetry-tracker/security/advisories/new",
    detail: "GitHub advisories",
    sla: "See SECURITY.md",
    external: true,
  },
  {
    label: "GitHub",
    desc: "Bugs, feature requests, and contributions.",
    href: "https://github.com/Telemetry-Tracker/telemetry-tracker/issues/new/choose",
    detail: "Open an issue",
    sla: "Public tracker",
    external: true,
  },
] as const;

const faqs = [
  {
    q: "How fast is onboarding?",
    a: "Most teams install an SDK and see first events in under five minutes. Start with the quickstart in the docs if you want a guided path.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes — the Free tier includes 250K ingest units per month, 14-day retention, and one project. Pro (€15/mo) and Business (€99/mo) add volume and retention on the hosted cloud.",
  },
  {
    q: "Where is data stored?",
    a: "When you self-host, telemetry lives in your PostgreSQL database on infrastructure you control. You choose region, retention, and access policies.",
  },
  {
    q: "Can I self-host?",
    a: "Yes. The API and dashboard are open source — run them locally or deploy with Docker. See the self-hosting section in the docs.",
  },
];

const inputCls = authInputClassName;

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  const LabelTag = htmlFor ? "label" : "span";

  return (
    <div className="block">
      <div className="mb-1.5 flex items-center justify-between">
        <LabelTag
          {...(htmlFor ? { htmlFor } : {})}
          className="text-xs font-medium text-foreground"
        >
          {label}
        </LabelTag>
        {hint && !error ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
        {error ? <span className="text-[11px] text-destructive">{error}</span> : null}
      </div>
      {children}
    </div>
  );
}

const topicLabels: Record<ContactTopic, string> = {
  general: "General",
  support: "Support",
  security: "Security",
  business: "Business",
  other: "Other",
};

function validate(values: ContactValues): Partial<Record<keyof ContactValues, string>> {
  const errors: Partial<Record<keyof ContactValues, string>> = {};
  const name = values.name.trim();
  const email = values.email.trim();
  if (!name) errors.name = "Required";
  else if (name.length > 100) errors.name = "Too long";
  if (!email) errors.email = "Required";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Invalid email";
  if (values.company.length > 120) errors.company = "Too long";
  if (!(values.topic in topicLabels)) errors.topic = "Invalid topic";
  if (values.message.trim().length < 10) errors.message = "Tell us a bit more";
  else if (values.message.length > 2000) errors.message = "Too long";
  return errors;
}

export function ContactPageContent() {
  const [values, setValues] = useState<ContactValues>({
    name: "",
    email: "",
    company: "",
    topic: "general",
    message: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ContactValues, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");
  const [devLogged, setDevLogged] = useState(false);

  function update<K extends keyof ContactValues>(key: K, val: ContactValues[K]) {
    setValues((v) => ({ ...v, [key]: val }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
    if (submitError) setSubmitError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const fieldErrors = validate(values);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setStatus("submitting");
    setSubmitError(null);

    const result = await submitContactForm({
      ...values,
      name: values.name.trim(),
      email: values.email.trim(),
    });
    if (!result.ok) {
      setStatus("idle");
      setSubmitError(result.error);
      if (result.fields) setErrors(result.fields);
      return;
    }

    setDevLogged(Boolean(result.devLogged));
    setStatus("sent");
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />

      <main id="main-content" className="marketing-main-offset pt-32">
        <section className="relative overflow-hidden border-b border-border">
          <div aria-hidden className="glow-blue absolute inset-0 opacity-60" />
          <div aria-hidden className="grid-bg absolute inset-0 opacity-[0.35]" />
          <div className="relative mx-auto max-w-6xl px-6 py-20">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-pulse-dot rounded-full bg-success" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-success" />
              </span>
              Open source · self-hosted ready
            </p>
            <h1 className="mt-6 max-w-3xl text-balance text-5xl font-semibold tracking-tight md:text-6xl">
              Talk to the team behind Telemetry Tracker.
            </h1>
            <p className="mt-5 max-w-2xl text-balance text-base text-muted-foreground md:text-lg">
              Engineers answer every message. Whether you&apos;re evaluating, integrating, or running
              into a production issue — we&apos;re one form away.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-2xl border border-border bg-surface/40 p-8 md:p-10">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold tracking-tight">Send a message</h2>
                <span className="font-mono text-xs text-muted-foreground">/contact</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                We&apos;ll route this to the right person and reply by email.
              </p>

              {status === "sent" ? (
                <div className="mt-10 rounded-xl border border-border bg-background/60 p-8 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface">
                    <svg
                      viewBox="0 0 16 16"
                      className="h-4 w-4 text-success"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M3 8.5l3.5 3.5L13 5" />
                    </svg>
                  </div>
                  <h3 className="mt-4 text-base font-semibold">Message received</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {devLogged ? (
                      <>
                        Email is not configured in this environment — your message was logged for
                        development only. Use the Gmail link below to reach us.
                      </>
                    ) : (
                      <>
                        Your message was delivered to our team. We&apos;ll reply to {values.email}{" "}
                        within one business day.
                      </>
                    )}
                  </p>
                  <a
                    href={gmailComposeUrl({
                      subject: `Telemetry Tracker — ${topicLabels[values.topic]}`,
                      body: [
                        `Name: ${values.name}`,
                        values.company ? `Company: ${values.company}` : null,
                        "",
                        values.message,
                      ]
                        .filter(Boolean)
                        .join("\n"),
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 inline-flex items-center gap-1.5 text-sm text-brand hover:underline"
                  >
                    Or send via Gmail now
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
                  </a>
                </div>
              ) : (
                <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
                  {submitError ? (
                    <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
                      {submitError}
                    </p>
                  ) : null}
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Name" htmlFor="contact-name" error={errors.name}>
                      <input
                        id="contact-name"
                        type="text"
                        value={values.name}
                        onChange={(e) => update("name", e.target.value)}
                        autoComplete="name"
                        maxLength={100}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Work email" htmlFor="contact-email" error={errors.email}>
                      <input
                        id="contact-email"
                        type="email"
                        value={values.email}
                        onChange={(e) => update("email", e.target.value)}
                        autoComplete="email"
                        maxLength={255}
                        className={inputCls}
                      />
                    </Field>
                  </div>

                  <Field label="Company" hint="Optional" htmlFor="contact-company" error={errors.company}>
                    <input
                      id="contact-company"
                      type="text"
                      value={values.company}
                      onChange={(e) => update("company", e.target.value)}
                      autoComplete="organization"
                      maxLength={120}
                      className={inputCls}
                    />
                  </Field>

                  <Field label="Topic" error={errors.topic}>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(topicLabels) as ContactTopic[]).map((t) => (
                        <button
                          type="button"
                          key={t}
                          onClick={() => update("topic", t)}
                          className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                            values.topic === t
                              ? "border-border-strong bg-surface-elevated text-foreground"
                              : "border-border bg-transparent text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {topicLabels[t]}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label="Message" htmlFor="contact-message" error={errors.message}>
                    <textarea
                      id="contact-message"
                      value={values.message}
                      onChange={(e) => update("message", e.target.value)}
                      rows={6}
                      maxLength={2000}
                      placeholder="What are you trying to do, and where are you stuck?"
                      className={`${inputCls} resize-y leading-relaxed`}
                    />
                    <div className="mt-1.5 text-right font-mono text-[11px] text-muted-foreground">
                      {values.message.length} / 2000
                    </div>
                  </Field>

                  <div className="flex flex-col-reverse items-stretch gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      By submitting you agree to our{" "}
                      <Link
                        href="/privacy"
                        className="text-foreground/80 underline-offset-4 hover:underline"
                      >
                        privacy policy
                      </Link>
                      .
                    </p>
                    <button
                      type="submit"
                      disabled={status === "submitting"}
                      className="inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.01] disabled:opacity-60"
                    >
                      {status === "submitting" ? "Sending…" : "Send message"}
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
                    </button>
                  </div>
                </form>
              )}
            </div>

            <aside className="space-y-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Direct channels
              </p>
              {channels.map((c) => (
                <a
                  key={c.label}
                  href={c.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block rounded-xl border border-border bg-surface/40 p-5 transition-colors hover:border-border-strong hover:bg-surface"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">{c.label}</span>
                    <svg
                      viewBox="0 0 16 16"
                      className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M3 8h10M9 4l4 4-4 4" />
                    </svg>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{c.desc}</p>
                  <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-mono text-xs text-foreground/80">{c.detail}</span>
                    <span className="text-[11px] text-muted-foreground">{c.sla}</span>
                  </div>
                </a>
              ))}

              <div className="rounded-xl border border-border bg-surface/40 p-5">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Self-hosting
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Run the API and dashboard on your own infrastructure. Docker, PostgreSQL, and
                  optional Stripe billing.
                </p>
                <Link
                  href="/docs#self-hosting"
                  className="mt-3 inline-flex text-sm text-brand hover:underline"
                >
                  Self-hosting guide →
                </Link>
              </div>

              <MarketingSubscribeForm idPrefix="contact" />
            </aside>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="flex items-end justify-between gap-6">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">FAQ</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
                  Before you write.
                </h2>
              </div>
              <Link
                href="/docs"
                className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline-flex"
              >
                Read the docs →
              </Link>
            </div>

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
