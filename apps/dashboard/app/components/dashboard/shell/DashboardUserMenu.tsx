"use client";

import Link from "next/link";
import Image from "next/image";
import type { ComponentType, ReactNode } from "react";
import {
  BookOpen,
  Building2,
  ChevronDown,
  CreditCard,
  Key,
  Keyboard,
  LifeBuoy,
  LogOut,
  Settings,
  SlidersHorizontal,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { logoutAction } from "@/app/auth/actions";
import type { DashboardUser } from "@/lib/dashboard-user";
import { toDashboardAvatarUrl } from "@/lib/avatar-url";
import { useDashboardNavLinkProps } from "@/lib/use-dashboard-navigation";
import { DashboardPopover } from "./DashboardPopover";
import { ShellKbd } from "./DashboardPopover";
import { ThemeMenuLink } from "./ThemeMenuLink";

function userInitials(user: DashboardUser): string {
  const fromName = user.displayName?.trim();
  if (fromName) {
    const parts = fromName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
    }
    return fromName.slice(0, 2).toUpperCase();
  }
  return user.email.slice(0, 2).toUpperCase();
}

const ACCOUNT_LINKS = [
  { href: "/dashboard/settings/profile", label: "Profile", icon: User },
  { href: "/dashboard/settings/organization", label: "Organization", icon: Building2 },
  { href: "/dashboard/settings/team", label: "Team members", icon: Users },
  { href: "/dashboard/settings/billing", label: "Billing & usage", icon: CreditCard },
  { href: "/dashboard/settings/keys", label: "API keys", icon: Key },
];

const PREFERENCE_LINKS = [
  { href: "/dashboard/settings/shortcuts", label: "Keyboard shortcuts", icon: Keyboard, shortcut: "?" },
  { href: "/dashboard/settings/preferences", label: "Preferences", icon: SlidersHorizontal },
] as const;

const HELP_LINKS = [
  { href: "/docs", label: "Documentation", icon: BookOpen },
  { href: "/dashboard/settings/support", label: "Contact support", icon: LifeBuoy },
  { href: "/dashboard/settings/changelog", label: "What's new", icon: Sparkles },
];

function UserAvatarBadge({
  user,
  className,
}: {
  user: DashboardUser;
  className: string;
}) {
  const avatarUrl = toDashboardAvatarUrl(user.avatarUrl);
  if (avatarUrl) {
    const sizeMatch = className.match(/h-(\d+)/);
    const size = sizeMatch ? Number(sizeMatch[1]) * 4 : 24;
    return (
      <Image
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        unoptimized
        className={`rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span className={`grid place-items-center rounded-full bg-brand font-semibold text-primary-foreground ${className}`}>
      {userInitials(user)}
    </span>
  );
}

export function DashboardUserMenu({
  user,
  variant = "header",
}: {
  user: DashboardUser | null;
  variant?: "header" | "sidebar";
}) {
  const name = user?.displayName?.trim() || user?.email || "Account";
  const isSidebar = variant === "sidebar";

  return (
    <DashboardPopover
      align={isSidebar ? "left" : "right"}
      width="w-72"
      trigger={(toggle, open) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={`Account menu, ${name}`}
          className={
            isSidebar
              ? "flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-xs text-foreground hover:bg-muted/70"
              : "flex items-center gap-1.5 rounded-full border border-border bg-surface/60 p-1 pr-2 text-xs text-foreground hover:bg-surface"
          }
        >
          {user ? (
            <UserAvatarBadge user={user} className="h-6 w-6 text-[10px]" />
          ) : (
            <span className="grid h-6 w-6 place-items-center rounded-full bg-brand text-[10px] font-semibold text-primary-foreground">
              ?
            </span>
          )}
          {isSidebar ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground">{name}</span>
              {user?.email ? (
                <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
              ) : null}
            </span>
          ) : null}
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center gap-3 border-b border-border px-3 py-3">
            {user ? (
              <UserAvatarBadge user={user} className="h-9 w-9 text-xs" />
            ) : (
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand text-xs font-semibold text-primary-foreground">
                ?
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{name}</p>
              {user?.email ? (
                <p className="truncate font-mono text-[11px] text-muted-foreground">{user.email}</p>
              ) : null}
            </div>
          </div>
          <div className="p-1.5">
            <MenuGroup label="Account">
              {ACCOUNT_LINKS.map((item) => (
                <MenuLink key={item.href} {...item} onClick={close} />
              ))}
            </MenuGroup>
            <MenuGroup label="Preferences">
              {PREFERENCE_LINKS.map((item) => (
                <MenuLink key={item.href} {...item} onClick={close} />
              ))}
              <ThemeMenuLink onClick={close} />
            </MenuGroup>
            <MenuGroup label="Help">
              {HELP_LINKS.map((item) => (
                <MenuLink key={item.href} {...item} onClick={close} />
              ))}
            </MenuGroup>
            <SettingsEntryLink onNavigate={close} />
            <div className="my-1 h-px bg-border" />
            <form action={logoutAction}>
              <button
                type="submit"
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-surface"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="flex-1 text-left">Log out</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </DashboardPopover>
  );
}

function SettingsEntryLink({ onNavigate }: { onNavigate: () => void }) {
  const linkProps = useDashboardNavLinkProps("/dashboard/settings/profile", {
    onNavigate,
  });
  return (
    <Link
      {...linkProps}
      className="mx-1.5 mb-1 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface"
    >
      <Settings className="h-3.5 w-3.5 text-muted-foreground" />
      <span>All settings</span>
    </Link>
  );
}

function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pb-1">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function MenuLink({
  href,
  label,
  icon: Icon,
  shortcut,
  onClick,
}: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  shortcut?: string;
  onClick?: () => void;
}) {
  const linkProps = useDashboardNavLinkProps(href, { onNavigate: onClick });
  return (
    <Link
      {...linkProps}
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface"
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="flex-1">{label}</span>
      {shortcut ? <ShellKbd>{shortcut}</ShellKbd> : null}
    </Link>
  );
}
