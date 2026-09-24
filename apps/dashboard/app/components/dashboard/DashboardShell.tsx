"use client";

import { useDashboardCapabilities } from "./DashboardCapabilitiesContext";
import { DashboardKeyboardShortcuts } from "./shell/DashboardKeyboardShortcuts";
import type { DashboardSessionContext } from "@/lib/dashboard-capabilities";

function formatPeriodEnd(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return null;
  }
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const capabilities = useDashboardCapabilities();

  return (
    <>
      <DashboardKeyboardShortcuts />
      <main
        className="w-full min-w-0 px-4 py-5 sm:px-6 lg:pl-[16.5rem] lg:pr-6"
        id="main-content"
      >
        {capabilities?.billingHealth?.billingAlertVariant ? (
          <BillingAlert capabilities={capabilities} />
        ) : null}
        {capabilities?.usageQuota?.nearQuota ? (
          <QuotaBanner capabilities={capabilities} />
        ) : null}
        {children}
      </main>
    </>
  );
}

function BillingAlert({ capabilities }: { capabilities: DashboardSessionContext }) {
  const v = capabilities.billingHealth?.billingAlertVariant;
  const tier = capabilities.billingHealth?.storedPlanTier;
  const effective = capabilities.billingHealth?.effectivePlanTier;
  const end = formatPeriodEnd(capabilities.billingHealth?.stripeCurrentPeriodEnd ?? null);

  return (
    <div
      className={
        v === "past_due"
          ? "mb-4 rounded-lg border border-warning/35 bg-warning/10 px-4 py-3 text-sm text-foreground"
          : "mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground"
      }
      role="alert"
    >
      {v === "past_due" ? (
        <>
          <strong>Payment past due.</strong> Update your payment method via Stripe. Your{" "}
          <strong>{tier}</strong> limits still apply until the subscription updates.
        </>
      ) : v === "unpaid" ? (
        <>
          <strong>Subscription unpaid.</strong> Effective tier: <strong>{effective}</strong>.
        </>
      ) : v === "incomplete" ? (
        <>
          <strong>Subscription incomplete.</strong> Entitlements use the{" "}
          <strong>{effective}</strong> tier until payment completes.
        </>
      ) : v === "incomplete_expired" ? (
        <>
          <strong>Subscription setup expired.</strong> Entitlements use the{" "}
          <strong>{effective}</strong> tier until you subscribe again.
        </>
      ) : (
        <>
          <strong>Subscription canceled.</strong> Entitlements follow the{" "}
          <strong>{effective}</strong> tier.
        </>
      )}
      {end ? (
        <>
          {" "}
          Current period end: <strong>{end}</strong>.
        </>
      ) : null}
    </div>
  );
}

function QuotaBanner({ capabilities }: { capabilities: DashboardSessionContext }) {
  const q = capabilities.usageQuota!;
  return (
    <div
      className={
        q.quotaExceeded
          ? "mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
          : "mb-4 rounded-lg border border-warning/35 bg-warning/10 px-4 py-3 text-sm"
      }
      role="status"
    >
      {q.quotaExceeded ? (
        <>
          Monthly ingest is at or above your <strong>{q.planTier}</strong> plan limit (
          {q.monthlyIngestUsed.toLocaleString()} / {q.monthlyIngestLimit.toLocaleString()} units,{" "}
          <strong>{q.percentUsed}%</strong>). New ingest is being rejected.
        </>
      ) : (
        <>
          Monthly ingest usage is high: <strong>{q.percentUsed}%</strong> of your{" "}
          <strong>{q.planTier}</strong> plan limit.
        </>
      )}
    </div>
  );
}
