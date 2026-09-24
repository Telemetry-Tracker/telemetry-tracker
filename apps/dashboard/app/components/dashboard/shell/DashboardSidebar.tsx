"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu, X } from "lucide-react";
import type { ReactNode } from "react";
import { ComingSoonBadge } from "@/app/components/dashboard/coming-soon-ui";
import { useDashboardCapabilities } from "@/app/components/dashboard/DashboardCapabilitiesContext";
import { Logo } from "@/app/components/marketing/logo";
import { formatCompact } from "@/lib/overview-format";
import { buildDashboardNavTabHref } from "@/lib/overview-scope-url";
import { useDashboardNavLinkProps } from "@/lib/use-dashboard-navigation";
import {
  DASHBOARD_NAV,
  NAV_ICONS,
  SETTINGS_NAV,
  isNavItemActive,
  type SidebarNavItem,
} from "./dashboard-nav";
import { DashboardUserMenu } from "./DashboardUserMenu";
import type { DashboardUser } from "@/lib/dashboard-user";

function SidebarNavLink({
  item,
  pathname,
  searchParams,
  onNavigate,
}: {
  item: SidebarNavItem;
  pathname: string;
  searchParams: URLSearchParams;
  onNavigate?: () => void;
}) {
  const Icon = NAV_ICONS[item.icon];
  const active = isNavItemActive(pathname, item.href);
  const comingSoon = Boolean(item.comingSoon);
  const href = buildDashboardNavTabHref(item.href, searchParams);
  const linkProps = useDashboardNavLinkProps(href, { onNavigate });

  if (comingSoon) {
    return (
      <Link
        {...linkProps}
        className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground/75 hover:bg-muted/50 hover:text-muted-foreground"
        title="Coming soon"
      >
        {Icon ? <Icon className="size-4 shrink-0 opacity-70" aria-hidden /> : null}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <ComingSoonBadge compact />
      </Link>
    );
  }

  return (
    <Link
      {...linkProps}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
        active
          ? "bg-brand/15 text-foreground"
          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
      }`}
    >
      {Icon ? (
        <Icon
          className={`size-4 shrink-0 ${active ? "text-brand" : "opacity-80"}`}
          aria-hidden
        />
      ) : null}
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SidebarUsage() {
  const capabilities = useDashboardCapabilities();
  const quota = capabilities?.usageQuota;
  if (!quota || quota.monthlyIngestLimit <= 0) return null;
  const pct = Math.min(100, Math.round(quota.percentUsed));
  const tone = quota.quotaExceeded
    ? "bg-destructive"
    : quota.nearQuota
      ? "bg-warning"
      : "bg-brand";

  return (
    <div className="space-y-2">
      <p className="px-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Usage
      </p>
      <div className="space-y-1.5 px-0.5">
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>Ingest</span>
          <span className="tabular-nums">
            {formatCompact(quota.monthlyIngestUsed)} / {formatCompact(quota.monthlyIngestLimit)}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <Link
        href="/dashboard/settings/billing"
        className="block rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2 hover:bg-muted/50"
      >
        <p className="text-[12px] font-medium capitalize text-foreground">{quota.planTier} plan</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Billing &amp; usage</p>
      </Link>
    </div>
  );
}

export function DashboardSidebar({
  user,
  workspaceSlot,
  mobileOpen,
  onClose,
}: {
  user: DashboardUser | null;
  workspaceSlot: ReactNode;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const primary = DASHBOARD_NAV.filter((item) => !item.comingSoon);
  const soon = DASHBOARD_NAV.filter((item) => item.comingSoon);

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          aria-label="Close navigation"
          onClick={onClose}
        />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border/70 bg-background transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
            <Link
              href="/dashboard/overview"
              onClick={onClose}
              className="min-w-0"
              aria-label="Telemetry Tracker"
            >
              <Logo className="[&_img]:h-6 [&_img]:w-6 [&_span]:text-[13px]" />
            </Link>
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted lg:hidden"
              onClick={onClose}
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="min-w-0 overflow-hidden px-3 pb-3">{workspaceSlot}</div>

          <nav
            className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3"
            aria-label="Dashboard"
          >
            {primary.map((item) => (
              <SidebarNavLink
                key={item.href}
                item={item}
                pathname={pathname}
                searchParams={searchParams}
                onNavigate={onClose}
              />
            ))}
            <SidebarNavLink
              item={SETTINGS_NAV}
              pathname={pathname}
              searchParams={searchParams}
              onNavigate={onClose}
            />
            {soon.length > 0 ? (
              <div className="mt-3 space-y-0.5 border-t border-border/60 pt-3">
                {soon.map((item) => (
                  <SidebarNavLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    searchParams={searchParams}
                    onNavigate={onClose}
                  />
                ))}
              </div>
            ) : null}
          </nav>

          <div className="mt-auto space-y-3 border-t border-border/60 px-3 py-3">
            <SidebarUsage />
            <DashboardUserMenu user={user} variant="sidebar" />
          </div>
        </div>
      </aside>
    </>
  );
}

export function DashboardMobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
      onClick={onClick}
      aria-label="Open navigation"
    >
      <Menu className="size-4" />
    </button>
  );
}
