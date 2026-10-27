"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { createBillingCheckoutAction, createBillingPortalAction } from "@/app/dashboard/actions";
import {
  parsePaidPlanQueryParam,
  paidPlanQueryToCheckoutTier,
  billingUpgradeActions,
} from "@/lib/plan-pricing";

type BillingPlanIntentProps = {
  organizationId: string;
  canManageBilling: boolean;
  effectivePlanTier: string | null;
  hasStripeSubscription: boolean;
};

export function BillingPlanIntent({
  organizationId,
  canManageBilling,
  effectivePlanTier,
  hasStripeSubscription,
}: BillingPlanIntentProps) {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    // React Strict Mode guard: only run once
    if (startedRef.current) return;

    const paidPlan = parsePaidPlanQueryParam(searchParams.get("plan"));
    if (!paidPlan) return;

    const checkoutTier = paidPlanQueryToCheckoutTier(paidPlan);
    if (!checkoutTier) return;

    // Cannot manage billing: do not trigger action
    if (!canManageBilling) return;

    // Check if upgrade to this tier is allowed
    const upgrades = billingUpgradeActions(effectivePlanTier);
    const isAllowed =
      (checkoutTier === "PRO" && upgrades.showPro) ||
      (checkoutTier === "BUSINESS" && upgrades.showBusiness);

    const currentTier = (effectivePlanTier ?? "FREE").toUpperCase();
    const isSameTier = currentTier === checkoutTier;

    // Same tier: show status message
    if (isSameTier) {
      startedRef.current = true;
      setStatus(`You're already on ${checkoutTier === "PRO" ? "Pro" : "Business"}.`);
      return;
    }

    // Not allowed (e.g., already on higher tier)
    if (!isAllowed) {
      return;
    }

    startedRef.current = true;

    // Existing subscription: use billing portal for plan changes
    if (hasStripeSubscription) {
      setStatus("Redirecting to billing portal to change your plan...");
      void (async () => {
        const result = await createBillingPortalAction(organizationId);
        if (!result.ok) {
          toast.error(result.error);
          setStatus(null);
          startedRef.current = false;
          return;
        }
        window.location.href = result.url;
      })();
      return;
    }

    // First-time subscription: use Checkout
    setStatus("Redirecting to Stripe Checkout…");
    void (async () => {
      const result = await createBillingCheckoutAction(organizationId, checkoutTier);
      if (!result.ok) {
        // Check for structured error code
        try {
          const errorData = JSON.parse(result.error);
          if (errorData.code === "USE_BILLING_PORTAL") {
            // Fallback to portal if API says so
            const portalResult = await createBillingPortalAction(organizationId);
            if (portalResult.ok) {
              setStatus("Redirecting to billing portal...");
              window.location.href = portalResult.url;
              return;
            }
          }
        } catch {
          // Not JSON, show as-is
        }
        toast.error(result.error);
        setStatus(null);
        startedRef.current = false;
        return;
      }
      window.location.href = result.url;
    })();
  }, [searchParams, organizationId, canManageBilling, effectivePlanTier, hasStripeSubscription]);

  if (!status) return null;

  return (
    <div
      className="mb-4 rounded-lg border border-border bg-surface/50 px-4 py-3 text-sm text-foreground"
      role="status"
    >
      {status}
    </div>
  );
}
