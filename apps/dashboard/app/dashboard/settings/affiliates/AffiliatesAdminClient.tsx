"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Field,
  FieldGroup,
  Section,
  SettingsBtn,
  SettingsInput,
  SettingsPill,
} from "@/app/components/dashboard/settings/settings-ui";
import { Table, TableWrap } from "@/app/components/ui/Table";
import {
  AFFILIATE_APPLICATION_FILTERS,
  type AffiliateApplicationFilter,
  type AffiliateApplicationRow,
  type AffiliateListRow,
} from "@/lib/affiliate-admin-types";
import {
  AFFILIATE_PAYOUT_MINIMUM_LABEL,
  affiliateReferralUrl,
  formatEurCents,
  isValidAffiliateCodeFormat,
  suggestAffiliateCodeFromName,
} from "@/lib/affiliate-program";
import {
  approveAffiliateApplicationAction,
  createAffiliateAction,
  rejectAffiliateApplicationAction,
  setAffiliateStateAction,
} from "./actions";
import { CopyButton, ReferralLinksPanel } from "./ReferralLinksPanel";

const CODE_HINT = "2–64 characters: letters, numbers, hyphen, underscore. Must be unused.";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function statusTone(status: string): "warning" | "success" | "muted" {
  if (status === "pending") return "warning";
  if (status === "approved") return "success";
  return "muted";
}

function ApplicationReview({ application }: { application: AffiliateApplicationRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState(application.suggestedCode ?? suggestAffiliateCodeFromName(application.name));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [approvedCode, setApprovedCode] = useState<string | null>(null);
  const codeValid = isValidAffiliateCodeFormat(code);
  const codeId = `approve-code-${application.id}`;
  const noteId = `review-note-${application.id}`;

  function approve() {
    if (!codeValid) {
      setError(CODE_HINT);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await approveAffiliateApplicationAction({ applicationId: application.id, code, note });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setApprovedCode(result.code);
      toast.success(`Approved — affiliate code “${result.code}” created`);
    });
  }

  function reject() {
    setError(null);
    startTransition(async () => {
      const result = await rejectAffiliateApplicationAction({ applicationId: application.id, note });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Application rejected");
      router.refresh();
    });
  }

  if (approvedCode) {
    return (
      <div className="space-y-3">
        <p className="text-[13px]">
          Approved. Send {application.name} their referral link (we don&apos;t email applicants
          automatically):
        </p>
        <ReferralLinksPanel code={approvedCode} />
        <SettingsBtn type="button" size="sm" onClick={() => router.refresh()}>
          Done
        </SettingsBtn>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={codeId} className="text-[12px] text-muted-foreground">
            Referral code
          </label>
          <SettingsInput
            id={codeId}
            mono
            value={code}
            maxLength={64}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={!codeValid}
            aria-describedby={`${codeId}-hint`}
          />
          <p id={`${codeId}-hint`} className="mt-1 text-[11px] text-muted-foreground">
            {codeValid ? (
              <>
                Link: <code className="break-all">{affiliateReferralUrl(code)}</code>
              </>
            ) : (
              CODE_HINT
            )}
          </p>
        </div>
        <div>
          <label htmlFor={noteId} className="text-[12px] text-muted-foreground">
            Internal note (optional)
          </label>
          <SettingsInput id={noteId} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SettingsBtn type="button" variant="primary" size="sm" disabled={pending} onClick={approve}>
          {pending ? "Saving…" : "Approve & create affiliate"}
        </SettingsBtn>
        <SettingsBtn type="button" variant="danger" size="sm" disabled={pending} onClick={reject}>
          Reject
        </SettingsBtn>
      </div>
    </div>
  );
}

function ApplicationsSection({
  status,
  applications,
}: {
  status: AffiliateApplicationFilter;
  applications: AffiliateApplicationRow[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Section
      title="Applications"
      description="From the public /affiliates form. Applicants are never emailed automatically."
    >
      <nav aria-label="Filter applications by status" className="mb-4 flex flex-wrap gap-1.5">
        {AFFILIATE_APPLICATION_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={`/dashboard/settings/affiliates?status=${f.value}`}
            aria-current={status === f.value ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
              status === f.value
                ? "border-border-strong bg-surface-elevated text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {applications.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No {status === "all" ? "" : `${status} `}applications.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {applications.map((a) => {
            const open = openId === a.id;
            return (
              <li key={a.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-medium">{a.name}</span>
                      <SettingsPill tone={statusTone(a.status)}>{a.status}</SettingsPill>
                      {a.existingAffiliate ? (
                        <SettingsPill tone="brand">already affiliate: {a.existingAffiliate.code}</SettingsPill>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                      {a.email} · submitted {formatDate(a.createdAt)}
                    </div>
                  </div>
                  <SettingsBtn
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-expanded={open}
                    aria-controls={`application-${a.id}`}
                    onClick={() => setOpenId(open ? null : a.id)}
                  >
                    {open ? "Close" : a.status === "pending" ? "Review" : "Details"}
                  </SettingsBtn>
                </div>
                {open ? (
                  <div id={`application-${a.id}`} className="mt-4 space-y-4">
                    <dl className="grid gap-3 text-[13px] sm:grid-cols-[160px_1fr]">
                      <dt className="text-muted-foreground">Website / profile</dt>
                      <dd className="break-all">
                        <a
                          href={a.websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="text-brand hover:underline"
                        >
                          {a.websiteUrl}
                        </a>
                      </dd>
                      <dt className="text-muted-foreground">How they&apos;ll promote</dt>
                      <dd className="whitespace-pre-wrap">{a.promotionPlan}</dd>
                      <dt className="text-muted-foreground">Terms accepted</dt>
                      <dd>
                        {formatDate(a.termsAcceptedAt)} (version {a.termsVersion})
                      </dd>
                      {a.status !== "pending" ? (
                        <>
                          <dt className="text-muted-foreground">Reviewed</dt>
                          <dd>
                            {formatDate(a.reviewedAt)} by {a.reviewedByEmail ?? a.reviewedBy ?? "—"}
                            {a.reviewNote ? ` — “${a.reviewNote}”` : ""}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                    {a.status === "pending" ? <ApplicationReview application={a} /> : null}
                    {a.status === "approved" && a.affiliateCode ? (
                      <div className="space-y-2">
                        <ReferralLinksPanel code={a.affiliateCode} />
                        {a.affiliateId ? (
                          <Link
                            href={`/dashboard/settings/affiliates/${a.affiliateId}`}
                            className="text-[13px] text-brand hover:underline"
                          >
                            Open affiliate →
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function AffiliateStateButton({ affiliate }: { affiliate: AffiliateListRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = affiliate.state === "active" ? "disabled" : "active";
  return (
    <SettingsBtn
      type="button"
      size="sm"
      variant={next === "disabled" ? "ghost" : "outline"}
      disabled={pending}
      onClick={() => {
        if (
          next === "disabled" &&
          !window.confirm(
            `Disable ${affiliate.name}? New signups with “${affiliate.code}” stop being attributed and new invoices stop earning. Already-earned commission can still be paid.`
          )
        ) {
          return;
        }
        startTransition(async () => {
          const result = await setAffiliateStateAction({ affiliateId: affiliate.id, state: next });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(next === "disabled" ? "Affiliate disabled" : "Affiliate re-enabled");
          router.refresh();
        });
      }}
    >
      {next === "disabled" ? "Disable" : "Enable"}
    </SettingsBtn>
  );
}

function AffiliatesTable({ affiliates }: { affiliates: AffiliateListRow[] }) {
  return (
    <Section
      title="Affiliates"
      description={`Pending = in the hold period. Payable = past the hold, net of open clawbacks; payouts need at least ${AFFILIATE_PAYOUT_MINIMUM_LABEL}.`}
    >
      {affiliates.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No affiliates yet.</p>
      ) : (
        <TableWrap className="border-0 bg-transparent">
          <Table>
            <thead>
              <tr>
                <th>Affiliate / code</th>
                <th className="text-right">Referred</th>
                <th className="text-right">Paying</th>
                <th className="text-right">Pending</th>
                <th className="text-right">Payable</th>
                <th className="text-right">Paid</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {affiliates.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link
                      href={`/dashboard/settings/affiliates/${a.id}`}
                      className="font-medium text-foreground underline-offset-4 hover:text-brand hover:underline"
                    >
                      {a.name}
                    </Link>
                    <div className="text-[12px] text-muted-foreground">{a.email ?? "no email (payout hold)"}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="whitespace-nowrap font-mono text-[12px]">{a.code}</code>
                      {a.state !== "active" ? <SettingsPill tone="muted">{a.state}</SettingsPill> : null}
                    </div>
                  </td>
                  <td className="tabular text-right">{a.referralCount}</td>
                  <td className="tabular text-right">{a.payingReferralCount}</td>
                  <td className="tabular text-right">{formatEurCents(a.pendingCents)}</td>
                  <td className="tabular text-right">
                    {formatEurCents(a.currentPayableBalanceCents)}
                    {a.payoutEligible ? (
                      <div>
                        <SettingsPill tone="success">payout ready</SettingsPill>
                      </div>
                    ) : null}
                  </td>
                  <td className="tabular text-right">{formatEurCents(a.paidCents)}</td>
                  <td>
                    <div className="flex flex-col items-stretch gap-1">
                      <CopyButton value={affiliateReferralUrl(a.code)} label={`Copy referral URL for ${a.name}`} />
                      <AffiliateStateButton affiliate={a} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Section>
  );
}

function CreateAffiliateSection() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ code: string; name: string } | null>(null);

  const effectiveCode = codeTouched ? code : suggestAffiliateCodeFromName(name);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (effectiveCode && !isValidAffiliateCodeFormat(effectiveCode)) {
      setError(CODE_HINT);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createAffiliateAction({ name, email, code: effectiveCode });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreated({ code: result.code, name });
      setName("");
      setEmail("");
      setCode("");
      setCodeTouched(false);
      toast.success(`Affiliate “${result.code}” created`);
      router.refresh();
    });
  }

  return (
    <Section
      title="Create affiliate directly"
      description="For invited partners or a test affiliate (e.g. a production attribution check). Add an email — affiliates without one are on payout hold."
    >
      <form onSubmit={onSubmit} aria-label="Create affiliate">
        <FieldGroup>
          <Field label="Name" htmlFor="create-affiliate-name">
            <SettingsInput
              id="create-affiliate-name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Email" htmlFor="create-affiliate-email" hint="Used for self-referral checks.">
            <SettingsInput
              id="create-affiliate-email"
              type="email"
              value={email}
              maxLength={254}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Referral code" htmlFor="create-affiliate-code" hint={CODE_HINT}>
            <SettingsInput
              id="create-affiliate-code"
              mono
              value={effectiveCode}
              maxLength={64}
              placeholder="auto from name"
              onChange={(e) => {
                setCodeTouched(true);
                setCode(e.target.value);
              }}
            />
          </Field>
        </FieldGroup>
        {error ? (
          <p role="alert" className="mt-3 text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-4">
          <SettingsBtn type="submit" variant="primary" disabled={pending}>
            {pending ? "Creating…" : "Create affiliate"}
          </SettingsBtn>
        </div>
      </form>
      {created ? (
        <div className="mt-5 space-y-2 border-t border-border pt-5">
          <p className="text-[13px]">Created {created.name}. Share:</p>
          <ReferralLinksPanel code={created.code} />
        </div>
      ) : null}
    </Section>
  );
}

export function AffiliatesAdminClient({
  status,
  applications,
  applicationsError,
  affiliates,
  affiliatesError,
}: {
  status: AffiliateApplicationFilter;
  applications: AffiliateApplicationRow[];
  applicationsError: string | null;
  affiliates: AffiliateListRow[];
  affiliatesError: string | null;
}) {
  return (
    <div className="space-y-6 pb-24">
      {applicationsError ? (
        <p role="alert" className="text-[13px] text-destructive">{applicationsError}</p>
      ) : (
        <ApplicationsSection status={status} applications={applications} />
      )}
      {affiliatesError ? (
        <p role="alert" className="text-[13px] text-destructive">{affiliatesError}</p>
      ) : (
        <AffiliatesTable affiliates={affiliates} />
      )}
      <CreateAffiliateSection />
    </div>
  );
}

