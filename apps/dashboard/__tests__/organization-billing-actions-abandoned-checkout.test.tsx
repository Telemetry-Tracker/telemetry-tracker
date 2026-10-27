/**
 * Regression tests for TT-030 (#882):
 * FREE org with abandoned checkout (customer but no subscription) should see
 * "Upgrade to" and use Checkout, not "Change to" and portal.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OrganizationBillingActions } from "@/app/dashboard/settings/organization/OrganizationBillingActions";
import * as dashboardActions from "@/app/dashboard/actions";

vi.mock("@/app/dashboard/actions", () => ({
  createBillingCheckoutAction: vi.fn(),
  createBillingPortalAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe("OrganizationBillingActions - Abandoned Checkout Regression (TT-030)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (dashboardActions.createBillingCheckoutAction as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      url: "https://checkout.stripe.com/test",
    });
    (dashboardActions.createBillingPortalAction as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      url: "https://billing.stripe.com/portal",
    });
    delete (window as { location?: unknown }).location;
    (window as { location: { href: string } }).location = { href: "" };
  });

  it("FREE org with NO subscription (hasStripeCustomer=false) shows 'Upgrade to' and uses Checkout", async () => {
    render(
      <OrganizationBillingActions
        organizationId="org123"
        canManageBilling={true}
        hasStripeCustomer={false}
        planTier="FREE"
      />
    );

    // Should show "Upgrade to Pro" (not "Change to Pro")
    expect(screen.getByText((content, element) => {
      return element?.tagName === "BUTTON" && content.includes("Upgrade to") && content.includes("Pro");
    })).toBeTruthy();
    expect(screen.queryByText((content, element) => {
      return element?.tagName === "BUTTON" && content.includes("Change to") && content.includes("Pro");
    })).toBeNull();

    // Should show "Upgrade to Business" (not "Change to Business")
    const businessButton = screen.getByText((content, element) => {
      return element?.tagName === "BUTTON" && content.includes("Upgrade to") && content.includes("Business");
    });
    expect(businessButton).toBeTruthy();
    expect(screen.queryByText((content, element) => {
      return element?.tagName === "BUTTON" && content.includes("Change to") && content.includes("Business");
    })).toBeNull();

    // Click should trigger Checkout
    fireEvent.click(businessButton);

    await waitFor(() => {
      expect(dashboardActions.createBillingCheckoutAction).toHaveBeenCalledWith("org123", "BUSINESS");
      expect(dashboardActions.createBillingPortalAction).not.toHaveBeenCalled();
    });
  });

  it("FREE org with active subscription (hasStripeCustomer=true) shows 'Change to' and uses Portal", async () => {
    const { container } = render(
      <OrganizationBillingActions
        organizationId="org123"
        canManageBilling={true}
        hasStripeCustomer={true}
        planTier="FREE"
      />
    );

    // Should show "Change to Pro" (not "Upgrade to Pro")
    expect(container.textContent).toContain("Change to");
    expect(container.textContent).not.toContain("Upgrade to");

    // Find Pro button and click it
    const buttons = screen.getAllByRole("button");
    const proButton = buttons.find(btn => 
      btn.textContent?.includes("Change to") && btn.textContent?.includes("Pro")
    );
    expect(proButton).toBeDefined();

    if (proButton) {
      // Click should trigger Portal
      fireEvent.click(proButton);

      await waitFor(() => {
        expect(dashboardActions.createBillingPortalAction).toHaveBeenCalledWith("org123");
        expect(dashboardActions.createBillingCheckoutAction).not.toHaveBeenCalled();
      });
    }
  });

  it("PRO org with active subscription shows 'Change to Business' and uses Portal", async () => {
    const { container } = render(
      <OrganizationBillingActions
        organizationId="org123"
        canManageBilling={true}
        hasStripeCustomer={true}
        planTier="PRO"
      />
    );

    // Should have "Change to" text for Business
    expect(container.textContent).toContain("Change to");
    expect(container.textContent).toContain("Business");
    
    // Find the Business button and click it
    const buttons = screen.getAllByRole("button");
    const businessButton = buttons.find(btn => 
      btn.textContent?.includes("Change to") && btn.textContent?.includes("Business")
    );
    expect(businessButton).toBeDefined();

    if (businessButton) {
      fireEvent.click(businessButton);

      await waitFor(() => {
        expect(dashboardActions.createBillingPortalAction).toHaveBeenCalledWith("org123");
        expect(dashboardActions.createBillingCheckoutAction).not.toHaveBeenCalled();
      });
    }
  });

  it("Shows 'Manage billing' button when org has active subscription", () => {
    render(
      <OrganizationBillingActions
        organizationId="org123"
        canManageBilling={true}
        hasStripeCustomer={true}
        planTier="PRO"
      />
    );

    const manageButtons = screen.getAllByText((content, element) => {
      return element?.tagName === "BUTTON" && content === "Manage billing";
    });
    expect(manageButtons.length).toBeGreaterThan(0);
  });

  it("Does NOT show 'Manage billing' button when org has no subscription", () => {
    const { container } = render(
      <OrganizationBillingActions
        organizationId="org123"
        canManageBilling={true}
        hasStripeCustomer={false}
        planTier="FREE"
      />
    );

    // Component should render (has upgrade CTAs)
    expect(container.textContent).toContain("Upgrade to");
    
    // But should NOT have "Manage billing"
    expect(container.textContent).not.toContain("Manage billing");
  });
});
