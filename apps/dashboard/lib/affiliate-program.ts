/**
 * Public affiliate program facts for marketing copy, terms, and the founder admin.
 *
 * The commission engine lives in the API. These constants mirror it and are guarded by
 * `affiliate-program.test.ts`, which reads the API source and fails if they drift:
 *   - DEFAULT_COMMISSION_RATE_BPS / COMMISSION_HOLD_DAYS / HOSTED_PAID_PLAN_TIERS
 *     (apps/api/src/lib/affiliate-commission.ts)
 *   - PAYOUT_MINIMUM_CENTS (apps/api/src/lib/affiliate-payout.ts)
 *   - REFERRAL_ATTRIBUTION_WINDOW_DAYS (apps/api/src/lib/organization-attribution.ts)
 * Prices come from PLAN_LIST_PRICES_EUR — the same source the pricing page renders.
 */
import { HOSTED_DASHBOARD_URL } from "@/lib/hosted-cloud";
import { PLAN_LIST_PRICES_EUR } from "@/lib/plan-pricing";

/** 3000 basis points = 30%. */
export const AFFILIATE_COMMISSION_RATE_BPS = 3000;
export const AFFILIATE_COMMISSION_PERCENT = AFFILIATE_COMMISSION_RATE_BPS / 100;
/** Last-touch window from link click to signup. Attribution locks at signup. */
export const AFFILIATE_REFERRAL_WINDOW_DAYS = 60;
/** Each commission is held this long after the invoice is paid before it becomes payable. */
export const AFFILIATE_COMMISSION_HOLD_DAYS = 30;
/** Minimum payable balance before a (manual) payout. */
export const AFFILIATE_PAYOUT_MINIMUM_CENTS = 5000;
/** Hosted plans whose subscription revenue earns commission. Self-hosted never does. */
export const AFFILIATE_ELIGIBLE_PLAN_TIERS = ["PRO", "BUSINESS"] as const;
export type AffiliateEligiblePlanTier = (typeof AFFILIATE_ELIGIBLE_PLAN_TIERS)[number];

export const AFFILIATE_PLAN_LABELS: Record<AffiliateEligiblePlanTier, string> = {
  PRO: "Pro",
  BUSINESS: "Business",
};

/** Bump (and update AFFILIATE_TERMS_UPDATED) whenever /affiliates/terms changes materially. */
export const AFFILIATE_TERMS_VERSION = "2026-10-06";
export const AFFILIATE_TERMS_UPDATED = "October 6, 2026";

/** Same build-time flag as `?ref=` capture. The program pages 404 when it is off. */
export function isAffiliateProgramEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AFFILIATES_ENABLED === "true";
}

const eurFormatter = (fractionDigits: 0 | 2) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

/** EUR from integer cents, same locale/currency style as the pricing page (2 decimals only when needed). */
export function formatEurCents(cents: number): string {
  const whole = cents % 100 === 0;
  return eurFormatter(whole ? 0 : 2).format(cents / 100);
}

export const AFFILIATE_PAYOUT_MINIMUM_LABEL = formatEurCents(AFFILIATE_PAYOUT_MINIMUM_CENTS);

/** List price of an eligible plan in cents (monthly; there are no annual plans today). */
export function planMonthlyPriceCents(plan: AffiliateEligiblePlanTier): number {
  return Math.round(PLAN_LIST_PRICES_EUR[plan] * 100);
}

/**
 * Commission for ONE monthly invoice at list price, rounded down to the cent per invoice —
 * the same `floor(eligible × rate)` the API applies (eligible = amount paid − tax).
 */
export function commissionPerInvoiceCents(plan: AffiliateEligiblePlanTier): number {
  return Math.floor((planMonthlyPriceCents(plan) * AFFILIATE_COMMISSION_RATE_BPS) / 10_000);
}

export type AffiliateEarningExample = {
  id: string;
  label: string;
  customers: Partial<Record<AffiliateEligiblePlanTier, number>>;
  monthlyCents: number;
  yearlyCents: number;
};

function example(id: string, customers: Partial<Record<AffiliateEligiblePlanTier, number>>): AffiliateEarningExample {
  const monthlyCents = AFFILIATE_ELIGIBLE_PLAN_TIERS.reduce(
    (sum, plan) => sum + commissionPerInvoiceCents(plan) * (customers[plan] ?? 0),
    0
  );
  const parts = AFFILIATE_ELIGIBLE_PLAN_TIERS.filter((plan) => (customers[plan] ?? 0) > 0).map(
    (plan) => `${customers[plan]} ${AFFILIATE_PLAN_LABELS[plan]}`
  );
  const total = Object.values(customers).reduce((a, b) => a + (b ?? 0), 0);
  return {
    id,
    label: `${parts.join(" + ")} customer${total === 1 ? "" : "s"}`,
    customers,
    monthlyCents,
    yearlyCents: monthlyCents * 12,
  };
}

/** Plain earning examples derived from current list prices (cannot go stale vs the pricing page). */
export const AFFILIATE_EARNING_EXAMPLES: AffiliateEarningExample[] = [
  example("pro-10", { PRO: 10 }),
  example("pro-50", { PRO: 50 }),
  example("business-5", { BUSINESS: 5 }),
  example("mixed", { PRO: 20, BUSINESS: 3 }),
];

/** Canonical public origin for referral links (always the hosted site, never a self-host). */
export const AFFILIATE_LINK_ORIGIN = HOSTED_DASHBOARD_URL;

/** Path-only destinations that capture `?ref=` (verified in referral-destinations tests). */
export const AFFILIATE_DEEP_LINK_DESTINATIONS = [
  { path: "/", label: "Homepage" },
  { path: "/pricing", label: "Pricing" },
  { path: "/sentry-alternative", label: "Sentry alternative" },
  { path: "/docs/migrate-from-sentry", label: "Migrate from Sentry" },
  { path: "/error-tracking/nextjs", label: "Next.js error tracking" },
  { path: "/docs/nextjs", label: "Next.js SDK docs" },
  { path: "/self-hosted-error-tracking", label: "Self-hosted vs hosted" },
  { path: "/register", label: "Sign up" },
] as const;

/** `https://telemetry-tracker.com/<path>?ref=<code>` (code lowercased; existing query preserved). */
export function affiliateReferralUrl(code: string, path = "/"): string {
  const url = new URL(path, AFFILIATE_LINK_ORIGIN);
  url.searchParams.set("ref", code.trim().toLowerCase());
  return url.toString();
}

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Client-side mirror of the API code rule (server re-validates format + uniqueness). */
export function isValidAffiliateCodeFormat(raw: string): boolean {
  const trimmed = raw.trim();
  return CODE_RE.test(trimmed) && !UUID_RE.test(trimmed);
}

/** Mirror of the API slug (used only as an editable suggestion). */
export function suggestAffiliateCodeFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return isValidAffiliateCodeFormat(slug) ? slug : "";
}
