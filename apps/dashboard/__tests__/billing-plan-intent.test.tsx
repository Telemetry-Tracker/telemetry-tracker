/**
 * BillingPlanIntent component fires checkout once for eligible upgrades.
 */
import { render, waitFor, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { BillingPlanIntent } from "@/app/dashboard/settings/billing/BillingPlanIntent";
import { useSearchParams } from "next/navigation";
import * as dashboardActions from "@/app/dashboard/actions";

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(),
}));

vi.mock("@/app/dashboard/actions", () => ({
  createBillingCheckoutAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe("BillingPlanIntent", () => {
  let mockSearchParams: URLSearchParams;
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);
    delete (window as { location?: unknown }).location;
    window.location = { href: "" } as Location;
    (dashboardActions.createBillingCheckoutAction as Mock).mockResolvedValue({
      ok: true,
      url: "https://checkout.stripe.com/test-session",
    });
  });

  afterEach(() => {
    cleanup();
    window.location = originalLocation;
  });

  it("fires checkout once for FREE→PRO upgrade when plan=pro", async () => {
    mockSearchParams = new URLSearchParams("plan=pro");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    render(
      <BillingPlanIntent
        organizationId="org123"
        canManageBilling={true}
        effectivePlanTier="FREE"
      />
    );

    await waitFor(() => {
      expect(dashboardActions.createBillingCheckoutAction).toHaveBeenCalledWith("org123", "PRO");
      expect(dashboardActions.createBillingCheckoutAction).toHaveBeenCalledTimes(1);
      expect(window.location.href).toBe("https://checkout.stripe.com/test-session");
    });
  });

  it("fires checkout once for FREE→BUSINESS upgrade when plan=business", async () => {
    mockSearchParams = new URLSearchParams("plan=business");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    render(
      <BillingPlanIntent
        organizationId="org123"
        canManageBilling={true}
        effectivePlanTier="FREE"
      />
    );

    await waitFor(() => {
      expect(dashboardActions.createBillingCheckoutAction).toHaveBeenCalledWith("org123", "BUSINESS");
      expect(dashboardActions.createBillingCheckoutAction).toHaveBeenCalledTimes(1);
    });
  });

  it("fires checkout for PRO→BUSINESS upgrade when plan=business", async () => {
    mockSearchParams = new URLSearchParams("plan=business");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    render(
      <BillingPlanIntent
        organizationId="org123"
        canManageBilling={true}
        effectivePlanTier="PRO"
      />
    );

    await waitFor(() => {
      expect(dashboardActions.createBillingCheckoutAction).toHaveBeenCalledWith("org123", "BUSINESS");
      expect(dashboardActions.createBillingCheckoutAction).toHaveBeenCalledTimes(1);
    });
  });

  it("does not fire checkout when already on PRO and plan=pro", async () => {
    mockSearchParams = new URLSearchParams("plan=pro");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    render(
      <BillingPlanIntent
        organizationId="org123"
        canManageBilling={true}
        effectivePlanTier="PRO"
      />
    );

    // Give it a moment to ensure nothing fires
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(dashboardActions.createBillingCheckoutAction).not.toHaveBeenCalled();
  });

  it("does not fire checkout when already on BUSINESS", async () => {
    mockSearchParams = new URLSearchParams("plan=business");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    render(
      <BillingPlanIntent
        organizationId="org123"
        canManageBilling={true}
        effectivePlanTier="BUSINESS"
      />
    );

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(dashboardActions.createBillingCheckoutAction).not.toHaveBeenCalled();
  });

  it("does not fire checkout when canManageBilling is false", async () => {
    mockSearchParams = new URLSearchParams("plan=pro");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    render(
      <BillingPlanIntent
        organizationId="org123"
        canManageBilling={false}
        effectivePlanTier="FREE"
      />
    );

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(dashboardActions.createBillingCheckoutAction).not.toHaveBeenCalled();
  });

  it("does not fire checkout when no plan query param", async () => {
    mockSearchParams = new URLSearchParams();
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    render(
      <BillingPlanIntent
        organizationId="org123"
        canManageBilling={true}
        effectivePlanTier="FREE"
      />
    );

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(dashboardActions.createBillingCheckoutAction).not.toHaveBeenCalled();
  });

  it("does not fire checkout for invalid plan value", async () => {
    mockSearchParams = new URLSearchParams("plan=free");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);

    render(
      <BillingPlanIntent
        organizationId="org123"
        canManageBilling={true}
        effectivePlanTier="FREE"
      />
    );

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(dashboardActions.createBillingCheckoutAction).not.toHaveBeenCalled();
  });

  it("does not redirect on checkout error", async () => {
    mockSearchParams = new URLSearchParams("plan=pro");
    (useSearchParams as Mock).mockReturnValue(mockSearchParams);
    (dashboardActions.createBillingCheckoutAction as Mock).mockResolvedValue({
      ok: false,
      error: "Checkout failed",
    });

    render(
      <BillingPlanIntent
        organizationId="org123"
        canManageBilling={true}
        effectivePlanTier="FREE"
      />
    );

    await waitFor(() => {
      expect(dashboardActions.createBillingCheckoutAction).toHaveBeenCalledTimes(1);
    });
    expect(window.location.href).toBe("");
  });
});
