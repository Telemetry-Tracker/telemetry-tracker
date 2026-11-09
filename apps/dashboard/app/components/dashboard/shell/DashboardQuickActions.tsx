"use client";

import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Flag,
  FolderPlus,
  GitBranch,
  Key,
  LayoutDashboard,
  LineChart,
  Plus,
  ScrollText,
  UserPlus,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { ComingSoonBadge } from "@/app/components/dashboard/coming-soon-ui";
import { ORGANIZATION_SETTINGS_NEW_PROJECT_URL } from "@/app/components/OrganizationSettingsNewProjectParam";
import { useDashboardNavLinkProps } from "@/lib/use-dashboard-navigation";
import { DashboardPopover } from "./DashboardPopover";

type Action = {
  id: string;
  label: string;
  icon: typeof Plus;
  href?: string;
  comingSoon?: boolean;
};

const ACTIONS: Action[] = [
  { id: "project", label: "Create project", icon: FolderPlus, href: ORGANIZATION_SETTINGS_NEW_PROJECT_URL },
  { id: "connect-app", label: "Connect application", icon: Workflow, href: "/dashboard/apps/connect" },
  { id: "invite", label: "Invite team member", icon: UserPlus, href: "/dashboard/settings/team" },
  { id: "key", label: "Generate API key", icon: Key, href: "/dashboard/settings/keys" },
  { id: "dashboard", label: "Create dashboard", icon: LayoutDashboard, comingSoon: true },
  { id: "alert", label: "Create alert", icon: Bell, href: "/dashboard/alerts" },
  { id: "flag", label: "Create feature flag", icon: Flag, comingSoon: true },
  { id: "release", label: "Track release", icon: GitBranch, href: "/dashboard/releases" },
  { id: "export", label: "Export report", icon: BarChart3, comingSoon: true },
];

export function DashboardQuickActions() {
  return (
    <DashboardPopover
      align="right"
      width="w-80"
      trigger={(toggle, open) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label="Create"
          className="grid h-8 w-8 place-items-center rounded-md border border-border bg-surface/60 text-foreground hover:bg-surface"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
        </button>
      )}
    >
      {(close) => (
        <div className="p-1.5">
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Create
          </div>
          {ACTIONS.map((a) =>
            a.comingSoon ? (
              <button
                key={a.id}
                type="button"
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-surface"
                onClick={() => {
                  toast.message("Coming soon", { description: `${a.label} is not available yet.` });
                  close();
                }}
              >
                <ActionIcon icon={a.icon} />
                <span className="flex-1">{a.label}</span>
                <ComingSoonBadge />
              </button>
            ) : (
              <QuickActionLink
                key={a.id}
                href={a.href!}
                label={a.label}
                icon={a.icon}
                onNavigate={close}
              />
            )
          )}
          <div className="my-1 h-px bg-border" />
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Explore (coming soon)
          </div>
          {[
            { label: "New trace query", icon: Workflow },
            { label: "Log pipeline", icon: ScrollText },
            { label: "Performance check", icon: LineChart },
            { label: "Incident", icon: AlertTriangle },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-surface"
              onClick={() => {
                toast.message("Coming soon", { description: `${item.label} is not available yet.` });
                close();
              }}
            >
              <ActionIcon icon={item.icon} />
              <span className="flex-1">{item.label}</span>
              <ComingSoonBadge />
            </button>
          ))}
        </div>
      )}
    </DashboardPopover>
  );
}

function QuickActionLink({
  href,
  label,
  icon,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: typeof Plus;
  onNavigate: () => void;
}) {
  const linkProps = useDashboardNavLinkProps(href, { onNavigate });
  return (
    <Link
      {...linkProps}
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface"
    >
      <ActionIcon icon={icon} />
      <span className="flex-1">{label}</span>
    </Link>
  );
}

function ActionIcon({ icon: Icon }: { icon: typeof Plus }) {
  return (
    <span className="grid h-6 w-6 place-items-center rounded-md border border-border bg-background text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}
