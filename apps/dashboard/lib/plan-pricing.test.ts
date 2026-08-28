import { describe, expect, it } from "vitest";
import {
  billingStatusHint,
  billingUpgradeActions,
  formatPlanPriceEur,
  PLAN_LIST_PRICES_EUR,
  resolveEffectivePlanTier,
  usageUnavailableMessage,
} from "./plan-pricing";

describe("plan-pricing", () => {
  it("formats EUR list prices", () => {
    expect(formatPlanPriceEur(PLAN_LIST_PRICES_EUR.FREE)).toBe("€0");
    expect(formatPlanPriceEur(PLAN_LIST_PRICES_EUR.PRO)).toMatch(/15/);
    expect(formatPlanPriceEur(PLAN_LIST_PRICES_EUR.BUSINESS)).toMatch(/99/);
    expect(PLAN_LIST_PRICES_EUR.PRO).toBe(15);
    expect(PLAN_LIST_PRICES_EUR.FREE).toBe(0);
    expect(PLAN_LIST_PRICES_EUR.BUSINESS).toBe(99);
  });

  it("falls back to usage plan tier for effective plan display", () => {
    expect(resolveEffectivePlanTier(null, { planTier: "PRO" })).toBe("PRO");
    expect(resolveEffectivePlanTier({ effectivePlanTier: "BUSINESS" }, { planTier: "PRO" })).toBe(
      "BUSINESS"
    );
  });

  it("describes usage gaps without always asking for project selection", () => {
    expect(
      usageUnavailableMessage({
        hasProjects: false,
        effectiveProjectId: "",
        capabilitiesLoaded: true,
      })
    ).toMatch(/Create a project/);
    expect(
      usageUnavailableMessage({
        hasProjects: false,
        effectiveProjectId: "",
        capabilitiesLoaded: false,
      })
    ).toMatch(/could not be loaded/);
    expect(
      usageUnavailableMessage({
        hasProjects: true,
        effectiveProjectId: "proj-1",
        capabilitiesLoaded: true,
      })
    ).toMatch(/unavailable for the selected project/);
  });

  it("hides Pro upgrade CTA when already on Pro", () => {
    expect(billingUpgradeActions("PRO")).toEqual({
      showPro: false,
      showBusiness: true,
      primaryUpgrade: "BUSINESS",
    });
    expect(billingUpgradeActions("BUSINESS")).toEqual({
      showPro: false,
      showBusiness: false,
      primaryUpgrade: null,
    });
    expect(billingUpgradeActions("FREE")).toEqual({
      showPro: true,
      showBusiness: true,
      primaryUpgrade: "PRO",
    });
  });

  it("avoids upgrade hint when checkout controls are not shown", () => {
    expect(
      billingStatusHint({
        billing: null,
        hasStripeCustomer: false,
        canManageBilling: true,
        hasUpgradeActions: false,
        billingContextLoaded: false,
      })
    ).toMatch(/Refresh the page/);
    expect(
      billingStatusHint({
        billing: null,
        hasStripeCustomer: false,
        canManageBilling: true,
        hasUpgradeActions: false,
      })
    ).toMatch(/Create a project/);
    expect(
      billingStatusHint({
        billing: null,
        hasStripeCustomer: false,
        canManageBilling: true,
        hasUpgradeActions: true,
      })
    ).toMatch(/Upgrade below/);
  });
});
