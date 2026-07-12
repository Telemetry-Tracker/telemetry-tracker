"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateProfileAction } from "@/app/dashboard/actions";
import {
  SettingsPageBody,
  SettingsPageHeader,
} from "@/app/components/dashboard/settings/SettingsPageHeader";
import {
  Field,
  FieldGroup,
  Section,
  SettingsAvatar,
  SettingsBtn,
  SettingsInput,
  SettingsPill,
} from "@/app/components/dashboard/settings/settings-ui";
import type { DashboardUser } from "@/lib/dashboard-user";

export function ProfileSettingsClient({ user }: { user: DashboardUser }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [savedDisplayName, setSavedDisplayName] = useState(user.displayName ?? "");
  const [displayName, setDisplayName] = useState(savedDisplayName);
  const dirty = useMemo(
    () => displayName.trim() !== savedDisplayName.trim(),
    [displayName, savedDisplayName]
  );

  function discard() {
    setDisplayName(savedDisplayName);
  }

  function save() {
    startTransition(async () => {
      const result = await updateProfileAction(displayName);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const next = result.displayName ?? "";
      setSavedDisplayName(next);
      setDisplayName(next);
      toast.success("Profile updated");
      router.refresh();
    });
  }

  const avatarName = displayName.trim() || user.email;

  return (
    <>
      <SettingsPageHeader
        title="Profile"
        description="How you appear across Telemetry Tracker. Your display name is visible to other members of your organization."
        actions={
          <>
            <SettingsBtn variant="ghost" disabled={!dirty || pending} onClick={discard}>
              Discard
            </SettingsBtn>
            <SettingsBtn variant="primary" disabled={!dirty || pending} onClick={save}>
              {pending ? "Saving…" : "Save changes"}
            </SettingsBtn>
          </>
        }
      />
      <SettingsPageBody>
        <Section title="Avatar" description="Initials from your display name or email.">
          <div className="flex items-center gap-5">
            <SettingsAvatar name={avatarName} size={72} />
          </div>
        </Section>
        <Section title="Profile information">
          <FieldGroup>
            <Field label="Display name">
              <SettingsInput
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={120}
                disabled={pending}
              />
            </Field>
            <Field label="Email">
              <div className="flex items-center gap-2">
                <SettingsInput value={user.email} readOnly className="flex-1" />
                <SettingsPill tone="success">Verified</SettingsPill>
              </div>
            </Field>
          </FieldGroup>
        </Section>
      </SettingsPageBody>
    </>
  );
}
