"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { MarketingNavLink } from "@/app/components/marketing/MarketingNavLink";
import { useBodyScrollLock } from "@/lib/body-scroll-lock";
import { Logo } from "./logo";

const links = [
  { href: "/#features", label: "Features" },
  { href: "/#sdks", label: "SDKs" },
  { href: "/#product", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#docs", label: "Docs" },
];

const DASHBOARD_HREF = "/dashboard/overview";

export function Nav({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const primaryHref = isAuthenticated ? DASHBOARD_HREF : "/register";
  const primaryLabel = isAuthenticated ? "Open dashboard" : "Start tracking";
  const primaryPendingLabel = isAuthenticated ? "Opening dashboard…" : "Loading…";
  const signInHref = isAuthenticated ? DASHBOARD_HREF : "/login";
  const signInLabel = isAuthenticated ? "Dashboard" : "Sign in";

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useBodyScrollLock(menuOpen);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, closeMenu]);

  return (
    <header className="fixed inset-x-0 top-3 z-50 flex justify-center px-3 sm:top-4 sm:px-4">
      <div className="relative w-full max-w-5xl">
        <nav
          aria-label="Primary"
          className="flex w-full items-center justify-between gap-2 rounded-full border border-border bg-background/70 px-2 py-2 backdrop-blur-xl sm:gap-3 sm:px-3"
        >
          <Link href="/" className="min-w-0 shrink pl-1 sm:pl-2" onClick={closeMenu}>
            <Logo compact />
          </Link>

          <ul className="hidden items-center gap-0.5 lg:flex xl:gap-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="rounded-full px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface hover:text-foreground xl:px-3"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            <MarketingNavLink
              href={signInHref}
              pendingLabel={isAuthenticated ? "Opening dashboard…" : "Loading…"}
              className="hidden rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground lg:inline-block"
            >
              {signInLabel}
            </MarketingNavLink>
            <MarketingNavLink
              href={primaryHref}
              aria-label={primaryLabel}
              pendingLabel={primaryPendingLabel}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.02] sm:px-3.5"
            >
              <span className="hidden sm:inline">{primaryLabel}</span>
              <span className="sm:hidden">{isAuthenticated ? "Dashboard" : "Start"}</span>
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
            </MarketingNavLink>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-foreground transition-colors hover:bg-surface-elevated lg:hidden"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </nav>

        {menuOpen && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 top-0 -z-10 bg-background/60 backdrop-blur-sm lg:hidden"
              onClick={closeMenu}
            />
            <div
              id={menuId}
              className="absolute inset-x-0 top-[calc(100%+0.5rem)] overflow-hidden rounded-2xl border border-border bg-background/95 shadow-lg backdrop-blur-xl lg:hidden"
            >
              <ul className="flex flex-col p-2">
                {links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="block rounded-xl px-4 py-3 text-sm text-foreground transition-colors hover:bg-surface"
                      onClick={closeMenu}
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="border-t border-border p-2">
                <MarketingNavLink
                  href={signInHref}
                  pendingLabel={isAuthenticated ? "Opening dashboard…" : "Loading…"}
                  className="block rounded-xl px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
                  onClick={closeMenu}
                >
                  {signInLabel}
                </MarketingNavLink>
                {!isAuthenticated ? (
                  <MarketingNavLink
                    href="/register"
                    className="mt-1 block rounded-xl px-4 py-3 text-sm text-foreground transition-colors hover:bg-surface"
                    onClick={closeMenu}
                  >
                    Create account
                  </MarketingNavLink>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
