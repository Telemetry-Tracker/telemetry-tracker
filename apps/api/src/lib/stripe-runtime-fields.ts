/**
 * stripe-node v22 typings lag runtime JSON for some fields. Use these accessors
 * so webhooks stay typed without @ts-expect-error scattered in handlers.
 */

function finiteUnix(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Subscription current period end (unix seconds).
 *
 * - Legacy API versions (≤ 2025-02-24.acacia, e.g. older webhook endpoint pins) put
 *   `current_period_end` on the Subscription itself.
 * - Since 2025-03-31.basil (incl. the stripe@22 SDK default `dahlia`, used by
 *   `subscriptions.retrieve`) it only exists per item: `items.data[].current_period_end`.
 *
 * Prefer the top-level value when present; otherwise use the latest item period end.
 * Returns null when neither shape carries a number.
 */
export function stripeSubscriptionPeriodEndUnix(sub: unknown): number | null {
  if (typeof sub !== "object" || sub === null) return null;
  const top = finiteUnix((sub as { current_period_end?: unknown }).current_period_end);
  if (top !== null) return top;

  const items = (sub as { items?: { data?: unknown } }).items?.data;
  if (!Array.isArray(items)) return null;
  let max: number | null = null;
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const n = finiteUnix((item as { current_period_end?: unknown }).current_period_end);
    if (n !== null && (max === null || n > max)) max = n;
  }
  return max;
}
