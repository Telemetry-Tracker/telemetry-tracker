"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type FormEvent, useEffect } from "react";
import { createOrganizationAction } from "@/app/dashboard/actions";
import { SettingsBtn, SettingsInput } from "@/app/components/dashboard/settings/settings-ui";

declare global {
  interface Window {
    Rewardful?: {
      referral?: string;
    };
  }
}

export function CreateOrganizationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rewardfulReferralId, setRewardfulReferralId] = useState<string | null>(null);
  const [viaToken, setViaToken] = useState<string | null>(null);

  useEffect(() => {
    // Capture Rewardful referral UUID from global object
    if (typeof window !== "undefined" && window.Rewardful?.referral) {
      setRewardfulReferralId(window.Rewardful.referral);
    }
    
    // Capture via token from URL query param
    const via = searchParams.get("via");
    if (via) {
      setViaToken(via);
    }
  }, [searchParams]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    
    // Add affiliate referral data if present
    if (rewardfulReferralId) {
      formData.set("rewardfulReferralId", rewardfulReferralId);
    }
    if (viaToken) {
      formData.set("viaToken", viaToken);
    }
    
    startTransition(async () => {
      const result = await createOrganizationAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="text-[13px] text-muted-foreground" htmlFor="org-name">
        Name
      </label>
      <SettingsInput
        id="org-name"
        name="name"
        type="text"
        required
        maxLength={120}
        placeholder="Acme Inc."
        autoComplete="organization"
        disabled={pending}
      />
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <SettingsBtn type="submit" variant="primary" disabled={pending}>
        {pending ? "Creating…" : "Create organization"}
      </SettingsBtn>
    </form>
  );
}
