import { describe, expect, it } from "vitest";
import { stripePriceIdForTier } from "./stripe-price-config.js";

describe("stripePriceIdForTier", () => {
  it("reads Pro and Business Price ids from env (not hardcoded)", () => {
    const env = {
      STRIPE_PRICE_PRO: "price_pro_new_15",
      STRIPE_PRICE_BUSINESS: "price_business_99",
    };
    expect(stripePriceIdForTier("PRO", env)).toBe("price_pro_new_15");
    expect(stripePriceIdForTier("BUSINESS", env)).toBe("price_business_99");
  });

  it("returns null when the env var is missing or blank", () => {
    expect(stripePriceIdForTier("PRO", {})).toBeNull();
    expect(stripePriceIdForTier("PRO", { STRIPE_PRICE_PRO: "  " })).toBeNull();
  });
});
