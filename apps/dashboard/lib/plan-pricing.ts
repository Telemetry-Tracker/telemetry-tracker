/**
 * Public list prices (EUR) for marketing and dashboard copy.
 * Stripe Price objects must use the same currency in the Stripe Dashboard.
 */
export const PLAN_LIST_PRICES_EUR = {
  FREE: 0,
  PRO: 15,
  BUSINESS: 99,
} as const;

export type PaidPlanTier = keyof typeof PLAN_LIST_PRICES_EUR;

export function formatPlanPriceEur(amount: number): string {
  if (amount === 0) return "€0";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function billingStatusLabel(
  billing: {
    stripeSubscriptionStatus: string | null;
    billingAlertVariant: string | null;
    effectivePlanTier: string;
  } | null
): string {
  if (!billing) return "Unknown";
  const v = billing.billingAlertVariant;
  if (v === "past_due") return "Past due";
  if (v === "unpaid") return "Unpaid";
  if (v === "canceled") return "Canceled";
  if (v === "incomplete") return "Incomplete";
  if (v === "incomplete_expired") return "Setup expired";
  const status = billing.stripeSubscriptionStatus?.toLowerCase();
  if (status === "active" || status === "trialing") return "Active";
  if (status) return billing.stripeSubscriptionStatus!;
  return billing.effectivePlanTier === "FREE" ? "Free tier" : billing.effectivePlanTier;
}

export function formatPeriodEnd(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return null;
  }
}

export function resolveEffectivePlanTier(
  billing: { effectivePlanTier: string } | null,
  usage: { planTier: string } | null
): string | null {
  return billing?.effectivePlanTier ?? usage?.planTier ?? null;
}

export type BillingUpgradeActions = {
  showPro: boolean;
  showBusiness: boolean;
  primaryUpgrade: "PRO" | "BUSINESS" | null;
};

/** Which upgrade CTAs to show for the org's current effective plan. */
export function billingUpgradeActions(planTier: string | null | undefined): BillingUpgradeActions {
  const tier = (planTier ?? "FREE").toUpperCase();
  if (tier === "BUSINESS") {
    return { showPro: false, showBusiness: false, primaryUpgrade: null };
  }
  if (tier === "PRO") {
    return { showPro: false, showBusiness: true, primaryUpgrade: "BUSINESS" };
  }
  return { showPro: true, showBusiness: true, primaryUpgrade: "PRO" };
}

export function billingStatusHint({
  billing,
  hasStripeCustomer,
  canManageBilling,
  hasUpgradeActions,
  billingContextLoaded = true,
}: {
  billing: BillingHealthInfoShape | null;
  hasStripeCustomer: boolean;
  canManageBilling: boolean;
  hasUpgradeActions: boolean;
  billingContextLoaded?: boolean;
}): string {
  if (!billingContextLoaded && canManageBilling) {
    return "Refresh the page to load billing and subscription details";
  }
  if (billing?.billingAlertVariant) {
    return "Update payment method in the Stripe portal";
  }
  if (hasStripeCustomer) return "Managed via Stripe";
  if (hasUpgradeActions) return "Upgrade below to start a subscription";
  if (canManageBilling) {
    return "Create a project to unlock usage tracking and upgrade controls";
  }
  return "Contact an organization owner to manage billing";
}

type BillingHealthInfoShape = Parameters<typeof billingStatusLabel>[0];

export function usageUnavailableMessage({
  hasProjects,
  effectiveProjectId,
  capabilitiesLoaded,
}: {
  hasProjects: boolean;
  effectiveProjectId: string;
  capabilitiesLoaded: boolean;
}): string {
  if (!capabilitiesLoaded) {
    return "Monthly ingest usage and subscription details could not be loaded for this session. Try refreshing the page.";
  }
  if (!hasProjects) {
    return "Create a project to track monthly ingest usage for this organization.";
  }
  if (effectiveProjectId === "") {
    return "Select a project in the header to load monthly ingest usage for this organization.";
  }
  return "Usage details are unavailable for the selected project. Try refreshing or choose another project.";
}

/**
 * Parse and normalize a plan query param to a lowercase paid plan intent, or null.
 * Accepts "pro", "PRO", "business", "BUSINESS" (trimmed). Rejects "free", empty, and invalid.
 */
export function parsePaidPlanQueryParam(
  raw: string | null | undefined
): "pro" | "business" | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "pro" || normalized === "business") {
    return normalized;
  }
  return null;
}

/**
 * Map a parsed paid plan intent to the Stripe Checkout tier enum.
 */
export function paidPlanQueryToCheckoutTier(
  plan: "pro" | "business" | null
): "PRO" | "BUSINESS" | null {
  if (plan === "pro") return "PRO";
  if (plan === "business") return "BUSINESS";
  return null;
}
