import Link from "next/link";
import {
  SettingsPageBody,
  SettingsPageHeader,
} from "@/app/components/dashboard/settings/SettingsPageHeader";
import { ErrorState } from "@/app/components/ErrorState";
import { Section, SettingsStat } from "@/app/components/dashboard/settings/settings-ui";
import { OrganizationUsageCard } from "@/app/dashboard/settings/organization/OrganizationUsageCard";
import { OrganizationBillingActions } from "@/app/dashboard/settings/organization/OrganizationBillingActions";
import { ORGANIZATION_SETTINGS_NEW_PROJECT_URL } from "@/app/components/OrganizationSettingsNewProjectParam";
import { getDashboardSessionContext } from "@/lib/dashboard-capabilities";
import {
  loadOrganizationMembers,
  resolveCanManageMembers,
} from "@/lib/dashboard-org-permissions";
import { getDashboardWorkspaceForRequest } from "@/lib/dashboard-workspace-request";
import { getDashboardUser } from "@/lib/dashboard-user";
import {
  billingStatusHint,
  billingStatusLabel,
  formatPeriodEnd,
  formatPlanPriceEur,
  PLAN_LIST_PRICES_EUR,
  resolveEffectivePlanTier,
  usageUnavailableMessage,
  parsePaidPlanQueryParam,
} from "@/lib/plan-pricing";
import { BillingPortalButton } from "./BillingPortalButton";
import { BillingPlanIntent } from "./BillingPlanIntent";

export const dynamic = "force-dynamic";

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const planParam = typeof params.plan === "string" ? params.plan : null;
  const paidPlan = parsePaidPlanQueryParam(planParam);

  const workspace = await getDashboardWorkspaceForRequest();
  const { organizations, projects, resolvedOrgId, effectiveProjectId } = workspace;
  const hasProjects = projects.length > 0;

  if (resolvedOrgId === null) {
    const orgSettingsHref = paidPlan
      ? `/dashboard/settings/organization?plan=${paidPlan}`
      : "/dashboard/settings/organization";
    return (
      <>
        <SettingsPageHeader
          title="Billing & usage"
          description="Create an organization to view plan limits and manage Stripe billing."
        />
        <ErrorState message="No organization selected. Create one under Organization settings first." />
        <p className="mt-4 text-sm">
          <Link href={orgSettingsHref} className="text-brand hover:underline">
            Go to Organization settings →
          </Link>
        </p>
      </>
    );
  }

  const orgName = organizations.find((o) => o.id === resolvedOrgId)?.name ?? "Organization";

  const [capabilities, membersRes, user] = await Promise.all([
    getDashboardSessionContext(
      effectiveProjectId === "" ? null : effectiveProjectId,
      resolvedOrgId
    ),
    loadOrganizationMembers(resolvedOrgId),
    getDashboardUser(),
  ]);

  const usage = capabilities?.usageQuota ?? null;
  const billing = capabilities?.billingHealth ?? null;
  const canManageBilling = resolveCanManageMembers({
    members: membersRes.ok ? membersRes.members : null,
    userId: user?.id,
    sessionCanManageMembers: capabilities?.canManageMembers,
  });
  const hasStripeCustomer = billing?.hasStripeCustomer === true;
  const billingContextLoaded = capabilities !== null;
  const effectivePlanTier = resolveEffectivePlanTier(billing, usage);
  const showBillingActions = canManageBilling && billingContextLoaded;
  const billingActionsInUsageCard = Boolean(usage && showBillingActions);
  const periodEnd = formatPeriodEnd(billing?.stripeCurrentPeriodEnd ?? null);
  const usageMessage = usageUnavailableMessage({
    hasProjects,
    effectiveProjectId,
    capabilitiesLoaded: billingContextLoaded,
  });

  return (
    <>
      <SettingsPageHeader
        title="Billing & usage"
        description={`Plan, monthly ingest, and Stripe billing for ${orgName}.`}
        actions={
          canManageBilling && hasStripeCustomer ? (
            <BillingPortalButton organizationId={resolvedOrgId} />
          ) : null
        }
      />
      <SettingsPageBody>
        <BillingPlanIntent
          organizationId={resolvedOrgId}
          canManageBilling={canManageBilling}
          effectivePlanTier={effectivePlanTier}
        />
        {capabilities === null ? (
          <p
            className="rounded-lg border border-warning/35 bg-warning/10 px-4 py-3 text-sm text-foreground"
            role="status"
          >
            Usage and billing details could not be loaded for this session. Try refreshing the
            page.
          </p>
        ) : null}

        <Section title="Current subscription">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SettingsStat
              label="Effective plan"
              value={effectivePlanTier ?? "—"}
              hint={
                billing && billing.storedPlanTier !== billing.effectivePlanTier
                  ? `Stored tier: ${billing.storedPlanTier}`
                  : "Limits applied to ingest and retention"
              }
            />
            <SettingsStat
              label="Billing status"
              value={billingStatusLabel(billing)}
              hint={billingStatusHint({
                billing,
                hasStripeCustomer,
                canManageBilling,
                hasUpgradeActions: showBillingActions && !hasStripeCustomer,
                billingContextLoaded,
              })}
            />
            <SettingsStat
              label="Current period ends"
              value={periodEnd ?? "—"}
              hint={hasStripeCustomer ? "From Stripe subscription" : "No active subscription"}
            />
          </div>
        </Section>

        {usage ? (
          <OrganizationUsageCard
            usage={usage}
            organizationId={resolvedOrgId}
            canManageBilling={canManageBilling}
            hasStripeCustomer={hasStripeCustomer}
          />
        ) : (
          <Section title="Usage">
            <p className="text-sm text-muted-foreground">{usageMessage}</p>
            {!hasProjects && capabilities !== null ? (
              <p className="mt-3 text-sm">
                <Link href={ORGANIZATION_SETTINGS_NEW_PROJECT_URL} className="text-brand hover:underline">
                  Create project →
                </Link>
              </p>
            ) : null}
          </Section>
        )}

        <Section
          title="Plans (EUR)"
          description="Prices billed per organization through Stripe on the official hosted cloud."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <PlanPriceCard
              name="Free"
              price={formatPlanPriceEur(PLAN_LIST_PRICES_EUR.FREE)}
              detail="250K ingest units / month · 14-day retention"
              current={effectivePlanTier === "FREE"}
            />
            <PlanPriceCard
              name="Pro"
              price={`${formatPlanPriceEur(PLAN_LIST_PRICES_EUR.PRO)} / mo`}
              detail="5M ingest units / month · 90-day retention"
              current={effectivePlanTier === "PRO"}
            />
            <PlanPriceCard
              name="Business"
              price={`${formatPlanPriceEur(PLAN_LIST_PRICES_EUR.BUSINESS)} / mo`}
              detail="50M ingest units / month · 365-day retention"
              current={effectivePlanTier === "BUSINESS"}
            />
          </div>
          {showBillingActions && !billingActionsInUsageCard ? (
            <OrganizationBillingActions
              organizationId={resolvedOrgId}
              canManageBilling={canManageBilling}
              hasStripeCustomer={hasStripeCustomer}
              planTier={effectivePlanTier ?? "FREE"}
            />
          ) : null}
          <p className="mt-4 text-[13px] text-muted-foreground">
            Need higher volume or a custom SLA?{" "}
            <Link href="/contact" className="text-brand hover:underline">
              Contact us
            </Link>
            .
          </p>
        </Section>
      </SettingsPageBody>
    </>
  );
}

function PlanPriceCard({
  name,
  price,
  detail,
  current,
}: {
  name: string;
  price: string;
  detail: string;
  current?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        current ? "border-brand/40 bg-brand/5" : "border-border bg-surface/30"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{name}</p>
        {current ? (
          <span className="rounded border border-border px-1.5 py-px text-[10px] uppercase text-muted-foreground">
            Current
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums">{price}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">{detail}</p>
    </div>
  );
}
