"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Section,
  SettingsBtn,
  SettingsInput,
  SettingsPill,
  SettingsStat,
} from "@/app/components/dashboard/settings/settings-ui";
import { Table, TableWrap, tableDateColumnClass } from "@/app/components/ui/Table";
import {
  canResolveNeedsAttention,
  commissionDisplayState,
  isCommissionPayable,
  isPayingReferral,
  openAdjustmentsTotalCents,
  type AffiliateDetail,
  type AffiliateOrganizationRow,
} from "@/lib/affiliate-admin-types";
import {
  AFFILIATE_PAYOUT_MINIMUM_CENTS,
  AFFILIATE_PAYOUT_MINIMUM_LABEL,
  formatEurCents,
} from "@/lib/affiliate-program";
import { recordAffiliatePayoutAction, resolveNeedsAttentionAction, setAffiliateStateAction } from "../actions";
import { ReferralLinksPanel } from "../ReferralLinksPanel";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `payout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ResolveAttentionForm({ org, affiliateId }: { org: AffiliateOrganizationRow; affiliateId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = `resolve-reason-${org.organizationId}`;

  if (!open) {
    return (
      <SettingsBtn type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Resolve
      </SettingsBtn>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) {
          setError("A reason is required (kept in the audit log).");
          return;
        }
        setError(null);
        startTransition(async () => {
          const result = await resolveNeedsAttentionAction({
            organizationId: org.organizationId,
            affiliateId,
            reason,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          toast.success(`Resolved — referral is now ${result.toStatus}`);
          router.refresh();
        });
      }}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="sr-only">
          Reason for resolving {org.name}
        </label>
        <SettingsInput
          id={inputId}
          placeholder="Reason (audit log)"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
        {error ? (
          <p role="alert" className="mt-1 text-[12px] text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <SettingsBtn type="submit" size="sm" variant="primary" disabled={pending}>
        {pending ? "Saving…" : "Confirm"}
      </SettingsBtn>
      <SettingsBtn type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </SettingsBtn>
    </form>
  );
}

function PayoutSection({ affiliate }: { affiliate: AffiliateDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const payable = useMemo(() => affiliate.commissions.filter((c) => isCommissionPayable(c)), [affiliate.commissions]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(payable.map((c) => c.id)));
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [referenceNote, setReferenceNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [error, setError] = useState<string | null>(null);

  const openAdjustments = openAdjustmentsTotalCents(affiliate.adjustments);
  const selectedCents = payable.filter((c) => selected.has(c.id)).reduce((s, c) => s + c.remainingCents, 0);
  const amountCents = selectedCents + openAdjustments;
  const belowMinimum = amountCents < AFFILIATE_PAYOUT_MINIMUM_CENTS;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (selected.size === 0) {
      setError("Select at least one payable commission.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await recordAffiliatePayoutAction({
        affiliateId: affiliate.id,
        commissionIds: [...selected],
        amountCents,
        paidAt: paidAt ? new Date(`${paidAt}T12:00:00Z`).toISOString() : undefined,
        referenceNote,
        idempotencyKey,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Payout of ${formatEurCents(result.amountCents)} recorded`);
      setIdempotencyKey(newIdempotencyKey());
      setReferenceNote("");
      router.refresh();
    });
  }

  return (
    <Section
      title="Record a payout"
      description={`Payouts are manual: pay the affiliate first, then record it here. Minimum ${AFFILIATE_PAYOUT_MINIMUM_LABEL}; open clawbacks are deducted automatically.`}
    >
      {payable.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nothing is payable yet.</p>
      ) : (
        <form onSubmit={onSubmit} aria-label="Record payout" className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-[12px] text-muted-foreground">Payable commissions</legend>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {payable.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <input
                    id={`payout-${c.id}`}
                    type="checkbox"
                    className="accent-brand"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <label htmlFor={`payout-${c.id}`} className="flex flex-1 flex-wrap justify-between gap-2">
                    <span className="font-mono text-[12px]">{c.stripeInvoiceId}</span>
                    <span className="tabular">{formatEurCents(c.remainingCents)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <dl className="grid grid-cols-[1fr_auto] gap-1 text-[13px]">
            <dt className="text-muted-foreground">Selected commissions</dt>
            <dd className="tabular text-right">{formatEurCents(selectedCents)}</dd>
            <dt className="text-muted-foreground">Open clawbacks</dt>
            <dd className="tabular text-right">{formatEurCents(openAdjustments)}</dd>
            <dt className="font-medium">Amount to record</dt>
            <dd className="tabular text-right font-medium">{formatEurCents(amountCents)}</dd>
          </dl>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="payout-paid-at" className="text-[12px] text-muted-foreground">
                Paid on
              </label>
              <SettingsInput id="payout-paid-at" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
            <div>
              <label htmlFor="payout-reference" className="text-[12px] text-muted-foreground">
                Reference (bank / PayPal transaction)
              </label>
              <SettingsInput
                id="payout-reference"
                value={referenceNote}
                maxLength={500}
                onChange={(e) => setReferenceNote(e.target.value)}
              />
            </div>
          </div>
          {belowMinimum ? (
            <p className="text-[12px] text-warning">
              Below the {AFFILIATE_PAYOUT_MINIMUM_LABEL} minimum — the API will refuse this payout.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
          <SettingsBtn type="submit" variant="primary" disabled={pending || selected.size === 0}>
            {pending ? "Recording…" : `Record payout of ${formatEurCents(amountCents)}`}
          </SettingsBtn>
        </form>
      )}
    </Section>
  );
}

export function AffiliateDetailClient({ affiliate }: { affiliate: AffiliateDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const nextState = affiliate.state === "active" ? "disabled" : "active";
  const orgNames = new Map(affiliate.organizations.map((o) => [o.organizationId, o.name]));

  return (
    <div className="space-y-6 pb-24">
      <div className="grid gap-3 sm:grid-cols-4">
        <SettingsStat label="Pending (hold)" value={formatEurCents(affiliate.pendingCents)} />
        <SettingsStat
          label="Payable now"
          value={formatEurCents(affiliate.currentPayableBalanceCents)}
          hint={affiliate.payoutEligible ? "Ready for payout" : `Below ${AFFILIATE_PAYOUT_MINIMUM_LABEL}`}
        />
        <SettingsStat label="Paid" value={formatEurCents(affiliate.paidCents)} />
        <SettingsStat
          label="Referred orgs"
          value={affiliate.organizations.length}
          hint={`${affiliate.organizations.filter(isPayingReferral).length} paying`}
        />
      </div>

      <Section
        title="Referral links"
        actions={
          <SettingsBtn
            type="button"
            size="sm"
            variant={nextState === "disabled" ? "danger" : "outline"}
            disabled={pending}
            onClick={() => {
              if (
                nextState === "disabled" &&
                !window.confirm(
                  "Disable this affiliate? Their code stops attributing new signups and new invoices stop earning. Already-earned commission can still be paid."
                )
              ) {
                return;
              }
              startTransition(async () => {
                const result = await setAffiliateStateAction({ affiliateId: affiliate.id, state: nextState });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success(nextState === "disabled" ? "Affiliate disabled" : "Affiliate re-enabled");
                router.refresh();
              });
            }}
          >
            {nextState === "disabled" ? "Disable affiliate" : "Re-enable affiliate"}
          </SettingsBtn>
        }
      >
        <ReferralLinksPanel code={affiliate.code} />
      </Section>

      <Section title="Referred organizations">
        {affiliate.organizations.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No referred organizations yet.</p>
        ) : (
          <TableWrap className="border-0 bg-transparent">
            <Table>
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th className={tableDateColumnClass}>Attributed</th>
                  <th>Needs attention</th>
                </tr>
              </thead>
              <tbody>
                {affiliate.organizations.map((o) => (
                  <tr key={o.organizationId}>
                    <td>{o.name}</td>
                    <td>{o.planTier}</td>
                    <td>
                      <SettingsPill tone={o.status === "ACTIVE" ? "success" : o.status === "REJECTED" ? "danger" : "muted"}>
                        {o.status}
                      </SettingsPill>
                      {isPayingReferral(o) ? (
                        <span className="ml-1.5">
                          <SettingsPill tone="brand">paying</SettingsPill>
                        </span>
                      ) : null}
                    </td>
                    <td className={tableDateColumnClass}>{formatDate(o.attributedAt)}</td>
                    <td>
                      {o.needsAttention ? (
                        <div className="space-y-1.5">
                          <div className="text-[12px] text-warning">{o.attentionReason ?? "needs attention"}</div>
                          {canResolveNeedsAttention(o) ? (
                            <ResolveAttentionForm org={o} affiliateId={affiliate.id} />
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Section>

      <PayoutSection affiliate={affiliate} key={affiliate.commissions.map((c) => `${c.id}:${c.state}`).join(",")} />

      <Section title="Commissions">
        {affiliate.commissions.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No commissions yet.</p>
        ) : (
          <TableWrap className="border-0 bg-transparent">
            <Table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Organization</th>
                  <th className="text-right">Amount</th>
                  <th>State</th>
                  <th className={tableDateColumnClass}>Paid by customer</th>
                  <th className={tableDateColumnClass}>Payable from</th>
                </tr>
              </thead>
              <tbody>
                {affiliate.commissions.map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono text-[12px]">{c.stripeInvoiceId}</td>
                    <td>{orgNames.get(c.organizationId) ?? c.organizationId.slice(0, 8)}</td>
                    <td className="tabular text-right">
                      {formatEurCents(c.remainingCents)}
                      {c.remainingCents !== c.amountCents ? (
                        <div className="text-[11px] text-muted-foreground">of {formatEurCents(c.amountCents)}</div>
                      ) : null}
                    </td>
                    <td>
                      <SettingsPill>{commissionDisplayState(c)}</SettingsPill>
                    </td>
                    <td className={tableDateColumnClass}>{formatDate(c.invoicePaidAt)}</td>
                    <td className={tableDateColumnClass}>{formatDate(c.payableAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Section>

      <Section title="Payouts">
        {affiliate.payouts.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No payouts recorded.</p>
        ) : (
          <TableWrap className="border-0 bg-transparent">
            <Table>
              <thead>
                <tr>
                  <th className={tableDateColumnClass}>Paid on</th>
                  <th className="text-right">Amount</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {affiliate.payouts.map((p) => (
                  <tr key={p.id}>
                    <td className={tableDateColumnClass}>{formatDate(p.paidAt)}</td>
                    <td className="tabular text-right">{formatEurCents(p.amountCents)}</td>
                    <td>{p.referenceNote ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Section>

      {affiliate.adjustments.length > 0 ? (
        <Section title="Adjustments" description="Clawbacks after refunds or disputes on already-paid commission.">
          <TableWrap className="border-0 bg-transparent">
            <Table>
              <thead>
                <tr>
                  <th className={tableDateColumnClass}>Created</th>
                  <th className="text-right">Amount</th>
                  <th>Reason</th>
                  <th>Settled</th>
                </tr>
              </thead>
              <tbody>
                {affiliate.adjustments.map((a) => (
                  <tr key={a.id}>
                    <td className={tableDateColumnClass}>{formatDate(a.createdAt)}</td>
                    <td className="tabular text-right">{formatEurCents(a.amountCents)}</td>
                    <td>{a.note ?? a.reason}</td>
                    <td>{a.payoutId ? "in payout" : "open"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Section>
      ) : null}
    </div>
  );
}
