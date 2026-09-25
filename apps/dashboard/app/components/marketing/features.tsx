import type { ReactNode } from "react";

const features = [
  {
    title: "Error tracking",
    desc: "Group and triage exceptions with stack traces, release tags, and symbolicated frames when source maps are uploaded.",
    icon: <path d="M8 2 L14 13 L2 13 Z M8 6.5 v3 M8 11 v0.5" />,
  },
  {
    title: "Event tracking",
    desc: "Typed events with custom properties. Query by user, route, app or anything you instrument.",
    icon: <path d="M2 8h3l2-4 2 8 2-4h3" />,
  },
  {
    title: "Session monitoring",
    desc: "Follow anonymous and identified sessions from first touch through logout.",
    icon: (
      <>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4v4l3 2" />
      </>
    ),
  },
  {
    title: "Alerting",
    desc: "Error spike and quota threshold rules with in-app notifications, email, and HTTPS webhooks.",
    icon: (
      <>
        <path d="M8 2.5a4 4 0 0 1 4 4v2.5l1.2 2.4H2.8L4 9V6.5a4 4 0 0 1 4-4z" />
        <path d="M7 12.5a1 1 0 0 0 2 0" />
      </>
    ),
  },
  {
    title: "Source maps",
    desc: "Upload JSON maps per app and release for readable stack traces on error detail — no more minified noise.",
    icon: (
      <>
        <path d="M3 4h10v8H3z" />
        <path d="M5 7h6M5 9.5h4" />
      </>
    ),
  },
  {
    title: "Multi-project",
    desc: "Web, mobile, server — keep environments isolated with their own keys and quotas.",
    icon: (
      <>
        <rect x="2" y="2" width="5" height="5" rx="1" />
        <rect x="9" y="2" width="5" height="5" rx="1" />
        <rect x="2" y="9" width="12" height="5" rx="1" />
      </>
    ),
  },
  {
    title: "Organizations & roles",
    desc: "Invite teammates, scope access per project with owner, editor and viewer roles.",
    icon: (
      <>
        <circle cx="6" cy="6" r="2.2" />
        <circle cx="11.5" cy="7" r="1.8" />
        <path d="M2 13c0-2 2-3 4-3s4 1 4 3M9 13c0-1.4 1.4-2.4 3-2.4s3 1 3 2.4" />
      </>
    ),
  },
];

export function Features() {
  return (
    <section id="features" className="relative scroll-mt-28 py-28">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="Platform"
          title={<>One platform for the signals you act on.</>}
          subtitle="Errors, events, sessions, alerts and source maps in one store — query them together, not across three tools."
        />

        <ul className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <li
              key={f.title}
              className="group relative bg-background p-6 transition-colors hover:bg-surface/60"
            >
              <span className="inline-grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface text-foreground">
                <svg
                  viewBox="0 0 16 16"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {f.icon}
                </svg>
              </span>
              <h3 className="mt-5 text-[15px] font-medium tracking-tight">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
  headingLevel = "h2",
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "center" | "left";
  headingLevel?: "h1" | "h2";
}) {
  const a = align === "center" ? "text-center mx-auto" : "text-left";
  const Heading = headingLevel;
  return (
    <div className={`${a} max-w-2xl`}>
      {eyebrow && (
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
      )}
      <Heading className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </Heading>
      {subtitle && (
        <p className="mt-4 text-balance text-base text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
