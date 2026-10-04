"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { createOrganizationAction } from "@/app/dashboard/actions";
import { SettingsBtn, SettingsInput } from "@/app/components/dashboard/settings/settings-ui";

export function CreateOrganizationForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
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
