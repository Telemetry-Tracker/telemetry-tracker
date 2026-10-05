/**
 * Affiliate program feature flag.
 * Effectively ON only when both AFFILIATES_ENABLED=true AND Stripe is configured.
 * When OFF: no script loading, no extra Stripe calls, no new routes (404), existing behavior unchanged.
 */

export function isAffiliateFeatureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.AFFILIATES_ENABLED !== "true") {
    return false;
  }
  // Also requires Stripe to be configured (no affiliate program without billing)
  const stripeKey = env.STRIPE_SECRET_KEY?.trim();
  if (!stripeKey) {
    return false;
  }
  return true;
}

/** Client-side equivalent: check if feature is enabled for script loading. */
export function getPublicAffiliateFeatureFlag(env: NodeJS.ProcessEnv = process.env): boolean {
  // Only expose when server-side flag is ON
  return isAffiliateFeatureEnabled(env);
}
