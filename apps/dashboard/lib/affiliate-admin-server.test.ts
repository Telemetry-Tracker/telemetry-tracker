import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/lib/dashboard-api", () => ({
  dashboardApiFetchFromCookies: (...args: unknown[]) => fetchMock(...args),
}));

import { hasAffiliateAdminAccess, isAffiliateAdminDenied } from "./affiliate-admin-server";

describe("hasAffiliateAdminAccess", () => {
  const prev = process.env.NEXT_PUBLIC_AFFILIATES_ENABLED;
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => {
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = prev;
  });

  it("does not call the API when the program flag is off", async () => {
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = "false";
    expect(await hasAffiliateAdminAccess()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("trusts only the API gate (session-only headers)", async () => {
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = "true";
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ admin: true }), { status: 200 }));
    expect(await hasAffiliateAdminAccess()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/meta/affiliates/access", undefined, {
      omitOrganizationHeader: true,
      omitProjectHeader: true,
    });
    for (const status of [401, 403, 404]) {
      fetchMock.mockResolvedValueOnce(new Response("{}", { status }));
      expect(await hasAffiliateAdminAccess()).toBe(false);
    }
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await hasAffiliateAdminAccess()).toBe(false);
  });

  it("treats 401/403/404 as denied", () => {
    expect([401, 403, 404].every(isAffiliateAdminDenied)).toBe(true);
    expect(isAffiliateAdminDenied(500)).toBe(false);
  });
});
