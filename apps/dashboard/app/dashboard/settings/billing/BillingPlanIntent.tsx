"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { createBillingCheckoutAction } from "@/app/dashboard/actions";
import {
  parsePaidPlanQueryParam,
  paidPlanQueryToCheckoutTier,
  billingUpgradeActions,
} from "@/lib/plan-pricing";

type BillingPlanIntentProps = {
  organizationId: string;
  canManageBilling: boolean;
  effectivePlanTier: string | null;
};

export function BillingPlanIntent({
  organizationId,
  canManageBilling,
  effectivePlanTier,
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

    // Cannot manage billing: do not trigger checkout
    if (!canManageBilling) return;

    // Check if upgrade to this tier is allowed
    const upgrades = billingUpgradeActions(effectivePlanTier);
    const isAllowed =
      (checkoutTier === "PRO" && upgrades.showPro) ||
      (checkoutTier === "BUSINESS" && upgrades.showBusiness);

    if (!isAllowed) {
      // Already on this tier or higher: silently ignore
      return;
    }

    startedRef.current = true;
    setStatus("Redirecting to Stripe Checkout…");

    void (async () => {
      const result = await createBillingCheckoutAction(organizationId, checkoutTier);
      if (!result.ok) {
        toast.error(result.error);
        setStatus(null);
        startedRef.current = false;
        return;
      }
      window.location.href = result.url;
    })();
  }, [searchParams, organizationId, canManageBilling, effectivePlanTier]);

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
