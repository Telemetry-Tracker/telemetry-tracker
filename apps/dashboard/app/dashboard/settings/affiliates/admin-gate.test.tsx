import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const access = vi.fn();
vi.mock("@/lib/affiliate-admin-server", () => ({
  hasAffiliateAdminAccess: () => access(),
  isAffiliateAdminDenied: (s: number) => [401, 403, 404].includes(s),
  loadAffiliateApplications: vi.fn(async () => ({ ok: true, data: { status: "pending", applications: [] } })),
  loadAffiliates: vi.fn(async () => ({ ok: true, data: { affiliates: [] } })),
  loadAffiliateDetail: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/dashboard/settings/affiliates",
}));
vi.mock("./actions", () => ({}));

import AffiliatesAdminPage from "./page";
import AffiliateDetailPage from "./[affiliateId]/page";
import { ReferralLinksPanel } from "./ReferralLinksPanel";
import { settingsNavGroups } from "@/app/components/dashboard/settings/SettingsNav";

describe("founder affiliate admin gate", () => {
  afterEach(cleanup);

  it("404s the admin pages unless the API confirms admin access", async () => {
    access.mockResolvedValue(false);
    await expect(AffiliatesAdminPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(
      AffiliateDetailPage({ params: Promise.resolve({ affiliateId: "00000000-0000-4000-8000-000000000000" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders for admins", async () => {
    access.mockResolvedValue(true);
    const el = await AffiliatesAdminPage({ searchParams: Promise.resolve({ status: "all" }) });
    expect(el).toBeTruthy();
  });

  it("hides the Founder nav group for non-admins", () => {
    expect(settingsNavGroups(false).some((g) => g.label === "Founder")).toBe(false);
    const founder = settingsNavGroups(true).find((g) => g.label === "Founder");
    expect(founder?.items).toEqual([{ href: "/dashboard/settings/affiliates", label: "Affiliates" }]);
  });
});

describe("ReferralLinksPanel", () => {
  afterEach(cleanup);
  it("shows the referral URL and copyable deep links", () => {
    render(<ReferralLinksPanel code="ada" />);
    expect(screen.getByText("https://telemetry-tracker.com/?ref=ada")).toBeTruthy();
    expect(screen.getByText("https://telemetry-tracker.com/pricing?ref=ada")).toBeTruthy();
    expect(screen.getByText("https://telemetry-tracker.com/register?ref=ada")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Copy/ }).length).toBeGreaterThan(5);
  });
});
