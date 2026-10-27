/**
 * Pricing CTAs render correctly with plan intent for authenticated and unauthenticated users.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Pricing } from "@/app/components/marketing/pricing";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("Pricing CTAs", () => {
  it("unauthenticated: Free → Start free → /register", () => {
    render(<Pricing isAuthenticated={false} />);
    const freeLinks = screen.getAllByRole("link", { name: "Start free" });
    expect(freeLinks.length).toBeGreaterThan(0);
    expect(freeLinks[0].getAttribute("href")).toBe("/register");
  });

  it("unauthenticated: Pro → Start with Pro → /register?plan=pro", () => {
    render(<Pricing isAuthenticated={false} />);
    const proLinks = screen.getAllByRole("link", { name: "Start with Pro" });
    expect(proLinks[0].getAttribute("href")).toBe("/register?plan=pro");
  });

  it("unauthenticated: Business → Start with Business → /register?plan=business", () => {
    render(<Pricing isAuthenticated={false} />);
    const businessLinks = screen.getAllByRole("link", { name: "Start with Business" });
    expect(businessLinks[0].getAttribute("href")).toBe("/register?plan=business");
  });

  it("unauthenticated: Custom → Contact us → /contact", () => {
    render(<Pricing isAuthenticated={false} />);
    const customLinks = screen.getAllByRole("link", { name: "Contact us" });
    expect(customLinks[0].getAttribute("href")).toBe("/contact");
  });

  it("authenticated: Free → Open dashboard → /dashboard/overview", () => {
    render(<Pricing isAuthenticated={true} />);
    const freeLinks = screen.getAllByRole("link", { name: "Open dashboard" });
    expect(freeLinks[0].getAttribute("href")).toBe("/dashboard/overview");
  });

  it("authenticated: Pro → Upgrade to Pro → /dashboard/settings/billing?plan=pro", () => {
    render(<Pricing isAuthenticated={true} />);
    const proLinks = screen.getAllByRole("link", { name: "Upgrade to Pro" });
    expect(proLinks[0].getAttribute("href")).toBe("/dashboard/settings/billing?plan=pro");
  });

  it("authenticated: Business → Upgrade to Business → /dashboard/settings/billing?plan=business", () => {
    render(<Pricing isAuthenticated={true} />);
    const businessLinks = screen.getAllByRole("link", { name: "Upgrade to Business" });
    expect(businessLinks[0].getAttribute("href")).toBe("/dashboard/settings/billing?plan=business");
  });

  it("authenticated: Custom → Contact us → /contact", () => {
    render(<Pricing isAuthenticated={true} />);
    const customLinks = screen.getAllByRole("link", { name: "Contact us" });
    expect(customLinks[0].getAttribute("href")).toBe("/contact");
  });

  it("unauthenticated: does not show 'Start free, upgrade later' on paid tiers", () => {
    const { container } = render(<Pricing isAuthenticated={false} />);
    expect(container.textContent).not.toContain("Start free, upgrade later");
  });

  it("authenticated: does not show 'Start free, upgrade later' on paid tiers", () => {
    const { container } = render(<Pricing isAuthenticated={true} />);
    expect(container.textContent).not.toContain("Start free, upgrade later");
  });
});
