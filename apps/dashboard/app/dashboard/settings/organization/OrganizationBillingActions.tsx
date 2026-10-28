"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  createBillingCheckoutAction,
  createBillingPortalAction,
} from "@/app/dashboard/actions";
import { SettingsBtn } from "@/app/components/dashboard/settings/settings-ui";
import {
  billingUpgradeActions,
  formatPlanPriceEur,
  PLAN_LIST_PRICES_EUR,
} from "@/lib/plan-pricing";

export function OrganizationBillingActions({
  organizationId,
  canManageBilling,
  hasStripeCustomer,
  planTier,
}: {
  organizationId: string;
  canManageBilling: boolean;
  hasStripeCustomer: boolean;
  planTier: string;
}) {
  const [pending, startTransition] = useTransition();
  const upgrades = billingUpgradeActions(planTier);
  const hasUpgradeCta = upgrades.showPro || upgrades.showBusiness;

  if (!canManageBilling) return null;

  function goCheckout(tier: "PRO" | "BUSINESS") {
    startTransition(async () => {
      // If customer has existing subscription, use portal instead of checkout
      if (hasStripeCustomer) {
        const r = await createBillingPortalAction(organizationId);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        window.location.href = r.url;
      } else {
        // First-time subscription: use checkout
        const r = await createBillingCheckoutAction(organizationId, tier);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        window.location.href = r.url;
      }
    });
  }

  function goPortal() {
    startTransition(async () => {
      const r = await createBillingPortalAction(organizationId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      window.location.href = r.url;
    });
  }

  if (!hasUpgradeCta && !hasStripeCustomer) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {upgrades.showPro ? (
        <SettingsBtn
          type="button"
          variant={upgrades.primaryUpgrade === "PRO" ? "primary" : "outline"}
          disabled={pending}
          onClick={() => goCheckout("PRO")}
        >
          {hasStripeCustomer ? "Change to" : "Upgrade to"} Pro ({formatPlanPriceEur(PLAN_LIST_PRICES_EUR.PRO)}/mo)
        </SettingsBtn>
      ) : null}
      {upgrades.showBusiness ? (
        <SettingsBtn
          type="button"
          variant={upgrades.primaryUpgrade === "BUSINESS" ? "primary" : "outline"}
          disabled={pending}
          onClick={() => goCheckout("BUSINESS")}
        >
          {hasStripeCustomer ? "Change to" : "Upgrade to"} Business ({formatPlanPriceEur(PLAN_LIST_PRICES_EUR.BUSINESS)}/mo)
        </SettingsBtn>
      ) : null}
      {hasStripeCustomer ? (
        <SettingsBtn
          type="button"
          variant={hasUpgradeCta ? "outline" : "primary"}
          disabled={pending}
          onClick={goPortal}
        >
          Manage billing
        </SettingsBtn>
      ) : null}
    </div>
  );
}
