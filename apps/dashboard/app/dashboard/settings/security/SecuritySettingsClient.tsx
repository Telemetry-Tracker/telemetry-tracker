"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  changePasswordAction,
  fetchAuthSessionsAction,
  revokeAuthSessionAction,
  revokeOtherAuthSessionsAction,
} from "@/app/dashboard/actions";
import {
  SettingsPageBody,
  SettingsPageHeader,
} from "@/app/components/dashboard/settings/SettingsPageHeader";
import {
  Field,
  FieldGroup,
  Section,
  SettingsBtn,
  SettingsInput,
  SettingsPill,
} from "@/app/components/dashboard/settings/settings-ui";
import { formatRelativeTime } from "@/lib/format-time";
import type { DashboardAuthSession } from "@/lib/security-settings";
import { formatSessionDevice } from "@/lib/session-display";

export function SecuritySettingsClient({
  initialSessions,
}: {
  initialSessions: DashboardAuthSession[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sessions, setSessions] = useState(initialSessions);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const otherSessions = useMemo(
    () => sessions.filter((session) => !session.current),
    [sessions]
  );

  function resetPasswordForm() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowPasswordForm(false);
  }

  async function refreshSessions() {
    const result = await fetchAuthSessionsAction();
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setSessions(result.sessions);
  }

  function changePassword() {
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    startTransition(async () => {
      const result = await changePasswordAction(currentPassword, newPassword);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Password updated");
      resetPasswordForm();
      await refreshSessions();
      router.refresh();
    });
  }

  function revokeSession(sessionId: string) {
    startTransition(async () => {
      const result = await revokeAuthSessionAction(sessionId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      toast.success("Session revoked");
      router.refresh();
    });
  }

  function revokeOtherSessions() {
    startTransition(async () => {
      const result = await revokeOtherAuthSessionsAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSessions((current) => current.filter((session) => session.current));
      toast.success(
        result.revoked === 1
          ? "Revoked 1 other session"
          : `Revoked ${result.revoked} other sessions`
      );
      router.refresh();
    });
  }

  return (
    <>
      <SettingsPageHeader
        title="Security"
        description="Password, sessions, and account protection."
      />
      <SettingsPageBody>
        <Section title="Password">
          <FieldGroup>
            <Field
              label="Password"
              hint="Use a strong password you do not reuse on other sites."
            >
              {showPasswordForm ? (
                <div className="space-y-3">
                  <SettingsInput
                    type="password"
                    autoComplete="current-password"
                    placeholder="Current password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    disabled={pending}
                  />
                  <SettingsInput
                    type="password"
                    autoComplete="new-password"
                    placeholder="New password (8+ characters)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={pending}
                  />
                  <SettingsInput
                    type="password"
                    autoComplete="new-password"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={pending}
                  />
                  <div className="flex flex-wrap gap-2">
                    <SettingsBtn
                      variant="primary"
                      disabled={
                        pending ||
                        !currentPassword ||
                        !newPassword ||
                        !confirmPassword
                      }
                      onClick={changePassword}
                    >
                      {pending ? "Updating…" : "Update password"}
                    </SettingsBtn>
                    <SettingsBtn variant="ghost" disabled={pending} onClick={resetPasswordForm}>
                      Cancel
                    </SettingsBtn>
                  </div>
                </div>
              ) : (
                <SettingsBtn variant="default" onClick={() => setShowPasswordForm(true)}>
                  Change password
                </SettingsBtn>
              )}
            </Field>
          </FieldGroup>
        </Section>

        <Section title="Two-factor authentication">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[13px]">Authenticator app</p>
              <p className="text-[12px] text-muted-foreground">
                Add a second factor for sign-in. Not available yet for self-hosted installs.
              </p>
            </div>
            <SettingsPill tone="muted">Coming soon</SettingsPill>
          </div>
        </Section>

        <Section
          title="Active sessions"
          description="Devices and browsers where you are signed in."
          footer={
            otherSessions.length > 0 ? (
              <SettingsBtn
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={revokeOtherSessions}
              >
                Revoke all other sessions
              </SettingsBtn>
            ) : undefined
          }
        >
          {sessions.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No active sessions found.</p>
          ) : (
            <ul className="divide-y divide-border">
              {sessions.map((session) => {
                const device =
                  formatSessionDevice(session.deviceBrowser, session.deviceOs) ??
                  "Unknown device";
                const subtitle = session.current
                  ? "Current session"
                  : `Signed in ${formatRelativeTime(session.createdAt)}`;
                return (
                  <li key={session.id} className="flex items-center gap-3 py-3">
                    <div className="flex-1">
                      <div className="text-[13px]">{device}</div>
                      <div className="text-[11px] text-muted-foreground">{subtitle}</div>
                    </div>
                    {session.current ? (
                      <SettingsPill tone="success">This device</SettingsPill>
                    ) : (
                      <SettingsBtn
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => revokeSession(session.id)}
                      >
                        Revoke
                      </SettingsBtn>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Sign-in alerts">
          <FieldGroup>
            <Field
              label="New device sign-in"
              hint="Email alerts for new sign-ins are not available yet. Use active sessions below to review and revoke access."
            >
              <SettingsPill tone="muted">Not available yet</SettingsPill>
            </Field>
          </FieldGroup>
        </Section>
      </SettingsPageBody>
    </>
  );
}
