/**
 * Stripe Price ids for new checkouts. Configured via env — never hardcode price_… ids.
 * Existing subscriptions are identified by plan_tier metadata, not by these Price ids.
 */
export function stripePriceIdForTier(
  tier: "PRO" | "BUSINESS",
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (tier === "PRO") {
    return env.STRIPE_PRICE_PRO?.trim() || null;
  }
  return env.STRIPE_PRICE_BUSINESS?.trim() || null;
}
