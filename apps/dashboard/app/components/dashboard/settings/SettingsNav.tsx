"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ComingSoonBadge } from "@/app/components/dashboard/coming-soon-ui";

type Item = { href: string; label: string; badge?: string; comingSoon?: boolean };
type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
  {
    label: "Account",
    items: [
      { href: "/dashboard/settings/profile", label: "Profile" },
      { href: "/dashboard/settings/preferences", label: "Preferences" },
      { href: "/dashboard/settings/appearance", label: "Appearance" },
      { href: "/dashboard/settings/notifications", label: "Notifications" },
      { href: "/dashboard/settings/shortcuts", label: "Keyboard shortcuts" },
      { href: "/dashboard/settings/security", label: "Security" },
      { href: "/dashboard/settings/keys", label: "API keys" },
      { href: "/dashboard/settings/source-maps", label: "Source maps" },
    ],
  },
  {
    label: "Organization",
    items: [
      { href: "/dashboard/settings/organization", label: "General" },
      { href: "/dashboard/settings/team", label: "Team members" },
      { href: "/dashboard/settings/billing", label: "Billing & usage" },
      { href: "/dashboard/settings/audit", label: "Audit log", comingSoon: true },
      { href: "/dashboard/settings/integrations", label: "Integrations", comingSoon: true },
      { href: "/dashboard/settings/labs", label: "Labs", comingSoon: true },
    ],
  },
  {
    label: "Resources",
    items: [
      { href: "/docs", label: "Documentation" },
      { href: "/dashboard/settings/changelog", label: "What's new" },
      { href: "/dashboard/settings/support", label: "Contact support" },
    ],
  },
];

export function SettingsNav() {
  const pathname = usePathname() ?? "/";

  return (
    <aside className="lg:sticky lg:top-28 lg:self-start">
      <div className="mb-4 px-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        Settings
      </div>
      <nav className="space-y-5 text-sm">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <div className="mb-1 px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              {g.label}
            </div>
            <ul className="space-y-px">
              {g.items.map((i) => {
                const active = pathname === i.href;
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors ${
                        active
                          ? "bg-surface text-foreground"
                          : "text-muted-foreground hover:bg-surface/60 hover:text-foreground"
                      }`}
                    >
                      <span className="min-w-0 truncate">{i.label}</span>
                      {i.comingSoon ? (
                        <ComingSoonBadge />
                      ) : i.badge ? (
                        <span className="shrink-0 rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                          {i.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
