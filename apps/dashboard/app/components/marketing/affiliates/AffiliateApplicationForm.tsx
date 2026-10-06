"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  submitAffiliateApplication,
  type AffiliateApplicationField,
} from "@/app/affiliates/actions";
import { authInputClassName } from "@/lib/input-classes";

export const APPLICATION_LIMITS = {
  name: 100,
  email: 254,
  websiteUrl: 300,
  promotionPlanMin: 20,
  promotionPlanMax: 1000,
} as const;

type Values = {
  name: string;
  email: string;
  websiteUrl: string;
  promotionPlan: string;
  acceptTerms: boolean;
  company_website: string;
};

type FieldErrors = Partial<Record<AffiliateApplicationField, string>>;

const EMPTY: Values = {
  name: "",
  email: "",
  websiteUrl: "",
  promotionPlan: "",
  acceptTerms: false,
  company_website: "",
};

export function validateAffiliateApplication(values: Values): FieldErrors {
  const errors: FieldErrors = {};
  const name = values.name.trim();
  const email = values.email.trim();
  const url = values.websiteUrl.trim();
  const plan = values.promotionPlan.trim();
  if (name.length < 2) errors.name = "Enter your name";
  else if (name.length > APPLICATION_LIMITS.name) errors.name = "Too long";
  if (!email) errors.email = "Required";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > APPLICATION_LIMITS.email) {
    errors.email = "Enter a valid email address";
  }
  if (!url) errors.websiteUrl = "Required";
  else if (url.length > APPLICATION_LIMITS.websiteUrl || !/^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(url)) {
    errors.websiteUrl = "Enter a valid URL";
  }
  if (plan.length < APPLICATION_LIMITS.promotionPlanMin) {
    errors.promotionPlan = `Tell us a bit more (at least ${APPLICATION_LIMITS.promotionPlanMin} characters)`;
  } else if (plan.length > APPLICATION_LIMITS.promotionPlanMax) {
    errors.promotionPlan = `Keep it under ${APPLICATION_LIMITS.promotionPlanMax} characters`;
  }
  if (!values.acceptTerms) errors.acceptTerms = "Accept the affiliate terms to apply";
  return errors;
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-foreground">
          {label}
        </label>
        {hint && !error ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[12px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AffiliateApplicationForm() {
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");
  const [successMessage, setSuccessMessage] = useState("");

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
    if (submitError) setSubmitError(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const fieldErrors = validateAffiliateApplication(values);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      const first = Object.keys(fieldErrors)[0];
      document.getElementById(`affiliate-${first}`)?.focus();
      return;
    }
    setStatus("submitting");
    setSubmitError(null);
    const result = await submitAffiliateApplication({
      ...values,
      name: values.name.trim(),
      email: values.email.trim(),
      websiteUrl: values.websiteUrl.trim(),
      promotionPlan: values.promotionPlan.trim(),
    });
    if (!result.ok) {
      setStatus("idle");
      setSubmitError(result.error);
      if (result.fields) setErrors(result.fields);
      return;
    }
    setSuccessMessage(result.message);
    setStatus("sent");
  }

  const describedBy = (key: AffiliateApplicationField) =>
    errors[key] ? `affiliate-${key}-error` : undefined;

  if (status === "sent") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-border bg-background/60 p-8 text-center"
      >
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface">
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4 text-success"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3 8.5l3.5 3.5L13 5" />
          </svg>
        </div>
        <h3 className="mt-4 text-base font-semibold">Application received</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{successMessage}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          We don&apos;t send automated emails. If you&apos;re approved, we&apos;ll contact you at{" "}
          <span className="text-foreground">{values.email.trim()}</span> with your referral link.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate aria-label="Affiliate application">
      {submitError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive"
        >
          {submitError}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="affiliate-name" label="Name" error={errors.name}>
          <input
            id="affiliate-name"
            name="name"
            type="text"
            required
            value={values.name}
            onChange={(e) => update("name", e.target.value)}
            autoComplete="name"
            maxLength={APPLICATION_LIMITS.name}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describedBy("name")}
            className={authInputClassName}
          />
        </Field>
        <Field id="affiliate-email" label="Email" error={errors.email}>
          <input
            id="affiliate-email"
            name="email"
            type="email"
            required
            value={values.email}
            onChange={(e) => update("email", e.target.value)}
            autoComplete="email"
            maxLength={APPLICATION_LIMITS.email}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy("email")}
            className={authInputClassName}
          />
        </Field>
      </div>

      <Field
        id="affiliate-websiteUrl"
        label="Website or profile URL"
        hint="Blog, newsletter, YouTube, GitHub…"
        error={errors.websiteUrl}
      >
        <input
          id="affiliate-websiteUrl"
          name="websiteUrl"
          type="url"
          inputMode="url"
          required
          placeholder="https://"
          value={values.websiteUrl}
          onChange={(e) => update("websiteUrl", e.target.value)}
          autoComplete="url"
          maxLength={APPLICATION_LIMITS.websiteUrl}
          aria-invalid={Boolean(errors.websiteUrl)}
          aria-describedby={describedBy("websiteUrl")}
          className={authInputClassName}
        />
      </Field>

      <Field
        id="affiliate-promotionPlan"
        label="How and where will you promote Telemetry Tracker?"
        error={errors.promotionPlan}
      >
        <textarea
          id="affiliate-promotionPlan"
          name="promotionPlan"
          required
          rows={5}
          value={values.promotionPlan}
          onChange={(e) => update("promotionPlan", e.target.value)}
          maxLength={APPLICATION_LIMITS.promotionPlanMax}
          placeholder="e.g. a Next.js error-tracking tutorial on my blog, a mention in my weekly newsletter (~3k devs), client recommendations…"
          aria-invalid={Boolean(errors.promotionPlan)}
          aria-describedby={["affiliate-promotionPlan-count", describedBy("promotionPlan")]
            .filter(Boolean)
            .join(" ")}
          className={`${authInputClassName} resize-y leading-relaxed`}
        />
        <div
          id="affiliate-promotionPlan-count"
          className="mt-1.5 text-right font-mono text-[11px] text-muted-foreground"
        >
          {values.promotionPlan.length} / {APPLICATION_LIMITS.promotionPlanMax}
        </div>
      </Field>

      {/* Honeypot: visually hidden and skipped by keyboard + assistive tech. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="affiliate-company-website">Company website (leave empty)</label>
        <input
          id="affiliate-company-website"
          name="company_website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={values.company_website}
          onChange={(e) => update("company_website", e.target.value)}
        />
      </div>

      <div>
        <div className="flex items-start gap-3">
          <input
            id="affiliate-acceptTerms"
            name="acceptTerms"
            type="checkbox"
            required
            checked={values.acceptTerms}
            onChange={(e) => update("acceptTerms", e.target.checked)}
            aria-invalid={Boolean(errors.acceptTerms)}
            aria-describedby={describedBy("acceptTerms")}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-brand"
          />
          <label htmlFor="affiliate-acceptTerms" className="text-sm text-muted-foreground">
            I have read and accept the{" "}
            <Link
              href="/affiliates/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline-offset-4 hover:underline"
            >
              affiliate terms
            </Link>
            .
          </label>
        </div>
        {errors.acceptTerms ? (
          <p id="affiliate-acceptTerms-error" className="mt-1.5 text-[12px] text-destructive">
            {errors.acceptTerms}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col-reverse items-stretch gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          No account needed. See our{" "}
          <Link href="/privacy#affiliate-applications" className="text-foreground/80 underline-offset-4 hover:underline">
            privacy policy
          </Link>{" "}
          for how we handle applications.
        </p>
        <button
          type="submit"
          disabled={status === "submitting"}
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.01] disabled:opacity-60"
        >
          {status === "submitting" ? "Submitting…" : "Apply to the program"}
        </button>
      </div>
    </form>
  );
}
