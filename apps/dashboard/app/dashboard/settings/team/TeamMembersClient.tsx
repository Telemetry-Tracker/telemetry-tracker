"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  inviteOrganizationMemberAction,
  updateOrganizationMemberRoleAction,
} from "@/app/dashboard/actions";
import { Section, SettingsAvatar, SettingsBtn, SettingsInput } from "@/app/components/dashboard/settings/settings-ui";
import { toDashboardAvatarUrl } from "@/lib/avatar-url";
import { Table, TableWrap, tableDateColumnClass } from "@/app/components/ui/Table";
import { TimeAgo } from "@/app/components/TimeAgo";
import { toast } from "sonner";

export type TeamMemberRow = {
  userId: string;
  email: string;
  displayName: string | null;
  avatarUrl?: string | null;
  role: string;
  joinedAt: string;
};

const ROLES = ["VIEWER", "EDITOR", "OWNER"] as const;

export function TeamMembersClient({
  organizationId,
  members,
  currentUserId,
  canManageMembers,
  ownerCount,
}: {
  organizationId: string;
  members: TeamMemberRow[];
  currentUserId: string;
  canManageMembers: boolean;
  ownerCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [optimisticRoleByUser, setOptimisticRoleByUser] = useState<Record<string, string>>({});
  const [roleChangePendingFor, setRoleChangePendingFor] = useState<string | null>(null);

  useEffect(() => {
    setOptimisticRoleByUser((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const uid of Object.keys(prev)) {
        const row = members.find((m) => m.userId === uid);
        if (row && row.role === prev[uid]) {
          delete next[uid];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [members]);

  function onInvite(formData: FormData) {
    setInviteError(null);
    setInviteUrl(null);
    formData.set("organizationId", organizationId);
    startTransition(async () => {
      const r = await inviteOrganizationMemberAction(null, formData);
      if (!r.ok) {
        setInviteError(r.error);
        return;
      }
      if ("inviteUrl" in r && r.inviteUrl) {
        setInviteUrl(r.inviteUrl);
      }
      router.refresh();
    });
  }

  function onRoleChange(userId: string, role: string) {
    setRoleError(null);
    setOptimisticRoleByUser((prev) => ({ ...prev, [userId]: role }));
    startTransition(async () => {
      setRoleChangePendingFor(userId);
      try {
        const r = await updateOrganizationMemberRoleAction(organizationId, userId, role);
        if (!r.ok) {
          setOptimisticRoleByUser((prev) => {
            const n = { ...prev };
            delete n[userId];
            return n;
          });
          setRoleError(r.error);
          return;
        }
        router.refresh();
      } finally {
        setRoleChangePendingFor(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {canManageMembers ? (
        <Section title="Invite member">
          <form action={onInvite} className="flex max-w-md flex-col gap-3">
            <label className="text-[13px] text-muted-foreground" htmlFor="invite-email">
              Email
            </label>
            <SettingsInput
              id="invite-email"
              name="email"
              type="email"
              required
              placeholder="colleague@company.com"
              disabled={pending}
              autoComplete="email"
            />
            <label className="text-[13px] text-muted-foreground" htmlFor="invite-role">
              Role
            </label>
            <select
              id="invite-role"
              name="role"
              className="w-full rounded-md border border-border bg-surface/60 px-3 py-1.5 text-[13px] outline-none focus:border-border-strong"
              disabled={pending}
              defaultValue="VIEWER"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {inviteError ? (
              <p className="text-sm text-destructive" role="alert">
                {inviteError}
              </p>
            ) : null}
            {inviteUrl ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <p className="text-sm text-muted-foreground">
                  Share this link to register:{" "}
                  <code className="break-all text-xs text-foreground">{inviteUrl}</code>
                </p>
                <SettingsBtn
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inviteUrl);
                      toast.success("Invite link copied to clipboard");
                    } catch {
                      toast.error("Could not copy invite link.");
                    }
                  }}
                  aria-label="Copy invite link"
                >
                  Copy link
                </SettingsBtn>
              </div>
            ) : null}
            <SettingsBtn type="submit" variant="primary" disabled={pending}>
              {pending ? "Sending…" : "Add or invite"}
            </SettingsBtn>
          </form>
        </Section>
      ) : null}

      {roleError ? (
        <p className="text-sm text-destructive" role="alert">
          {roleError}
        </p>
      ) : null}

      <Section title="Members">
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <TableWrap className="border-0 bg-transparent">
            <Table>
              <thead>
                <tr>
                  <th className="w-10" aria-label="Avatar" />
                  <th>Email</th>
                  <th className="hidden sm:table-cell">Name</th>
                  <th>Role</th>
                  <th className={tableDateColumnClass}>Joined</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const isSelf = m.userId === currentUserId;
                  const isOnlyOwner = m.role === "OWNER" && ownerCount <= 1;
                  const canEditRole = canManageMembers && !(isSelf && isOnlyOwner);
                  return (
                    <tr key={m.userId}>
                      <td>
                        <SettingsAvatar
                          name={m.displayName?.trim() || m.email}
                          src={toDashboardAvatarUrl(m.avatarUrl ?? null)}
                          size={28}
                        />
                      </td>
                      <td>{m.email}</td>
                      <td className="hidden sm:table-cell">{m.displayName ?? "—"}</td>
                      <td>
                        {canEditRole ? (
                          <select
                            className="rounded-md border border-border bg-surface/60 px-2 py-1 text-[13px]"
                            value={optimisticRoleByUser[m.userId] ?? m.role}
                            aria-label={`Role for ${m.email}`}
                            disabled={roleChangePendingFor === m.userId}
                            onChange={(e) => onRoleChange(m.userId, e.target.value)}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        ) : (
                          m.role
                        )}
                      </td>
                      <td className={tableDateColumnClass}>
                        <TimeAgo iso={m.joinedAt} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
