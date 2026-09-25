import { OrgRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { DashboardNotificationItem } from "./dashboard-notifications.js";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./notification-preferences.js";
import {
  notifyOrganizationMembersByEmail,
  notifyProjectMembersByEmail,
  sendNotificationEmailIfAllowed,
  sendOrganizationInviteEmail,
} from "./notification-email-dispatch.js";

vi.mock("./email.js", () => ({
  sendTransactionalEmail: vi.fn(async () => ({ sent: true, devLogged: false })),
}));

vi.mock("./dashboard-origin.js", () => ({
  dashboardOriginOrNull: () => "https://app.example.com",
}));

const emailEnabledPrefs = {
  ...DEFAULT_NOTIFICATION_PREFERENCES,
  channels: { ...DEFAULT_NOTIFICATION_PREFERENCES.channels, email: true },
};

const teamItem: DashboardNotificationItem = {
  id: "team:member:membership-abc",
  type: "team",
  title: "New team member",
  body: "New User joined your organization as editor.",
  occurredAt: new Date().toISOString(),
  href: "/dashboard/settings/team",
};

describe("notifyOrganizationMembersByEmail", () => {
  it("excludes the joining member from team join notifications", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      organizationMembership: {
        findMany: vi.fn(async () => [
          {
            user: {
              id: "owner-1",
              email: "owner@example.com",
              notification_preferences: emailEnabledPrefs,
            },
          },
          {
            user: {
              id: "new-1",
              email: "new@example.com",
              notification_preferences: emailEnabledPrefs,
            },
          },
        ]),
      },
      notificationEmailLog: {
        createMany,
        delete: vi.fn(),
      },
    } as unknown as Parameters<typeof notifyOrganizationMembersByEmail>[0];

    await notifyOrganizationMembersByEmail(prisma, "org-1", teamItem, {
      roles: [OrgRole.OWNER, OrgRole.EDITOR],
      excludeEmails: ["new@example.com"],
    });

    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it("still emails the other members when one createMany fails", async () => {
    const createMany = vi
      .fn()
      .mockRejectedValueOnce(new Error("Response from the Engine was empty"))
      .mockResolvedValueOnce({ count: 1 });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const prisma = {
      organizationMembership: {
        findMany: vi.fn(async () => [
          {
            user: {
              id: "owner-1",
              email: "owner@example.com",
              notification_preferences: emailEnabledPrefs,
            },
          },
          {
            user: {
              id: "editor-1",
              email: "editor@example.com",
              notification_preferences: emailEnabledPrefs,
            },
          },
        ]),
      },
      notificationEmailLog: {
        createMany,
        delete: vi.fn(),
      },
    } as unknown as Parameters<typeof notifyOrganizationMembersByEmail>[0];

    await expect(
      notifyOrganizationMembersByEmail(prisma, "org-1", teamItem)
    ).resolves.toBeUndefined();
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("notifyProjectMembersByEmail", () => {
  it("skips fan-out when project email delivery is disabled", async () => {
    const { sendTransactionalEmail } = await import("./email.js");
    const sendMock = vi.mocked(sendTransactionalEmail);
    sendMock.mockClear();

    const prisma = {
      project: {
        findFirst: vi.fn(async () => ({
          organization_id: "org-1",
          name: "Demo",
          alert_settings: {
            errorSpike: { enabled: true, threshold: 25, windowMinutes: 15 },
            quota: { enabled: true, nearPercent: 90 },
            email: { enabled: false, roles: ["OWNER"], additionalEmails: [] },
          },
        })),
      },
      organizationMembership: { findMany: vi.fn() },
      user: { findMany: vi.fn() },
      notificationEmailLog: { createMany: vi.fn(), delete: vi.fn() },
    } as never;

    await notifyProjectMembersByEmail(prisma, "proj-1", teamItem);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends additional non-member emails", async () => {
    const { sendTransactionalEmail } = await import("./email.js");
    const sendMock = vi.mocked(sendTransactionalEmail);
    sendMock.mockClear();
    sendMock.mockResolvedValue({ sent: true });

    const createMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      project: {
        findFirst: vi.fn(async () => ({
          organization_id: "org-1",
          name: "Demo",
          alert_settings: {
            errorSpike: { enabled: true, threshold: 25, windowMinutes: 15 },
            quota: { enabled: true, nearPercent: 90 },
            email: {
              enabled: true,
              roles: ["OWNER"],
              additionalEmails: ["pager@example.com"],
            },
          },
        })),
      },
      organizationMembership: {
        findMany: vi.fn(async () => [
          {
            user: {
              id: "owner-1",
              email: "owner@example.com",
              notification_preferences: emailEnabledPrefs,
            },
          },
        ]),
      },
      user: {
        findMany: vi.fn(async () => []),
      },
      notificationEmailLog: {
        createMany,
        delete: vi.fn(),
      },
    } as never;

    const alertItem: DashboardNotificationItem = {
      id: "alert:error_spike:p1:15:1",
      type: "alert",
      title: "Error spike detected",
      body: "Many errors",
      occurredAt: new Date().toISOString(),
      href: "/dashboard/errors",
    };

    await notifyProjectMembersByEmail(prisma, "proj-1", alertItem, {
      rule: "ERROR_SPIKE",
    });

    expect(createMany).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "pager@example.com" })
    );
  });
});

describe("sendNotificationEmailIfAllowed", () => {
  it("claims dedupe row before sending email", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const deleteMock = vi.fn(async () => ({}));
    const prisma = {
      notificationEmailLog: {
        createMany,
        delete: deleteMock,
      },
    } as unknown as Parameters<typeof sendNotificationEmailIfAllowed>[0];

    const sent = await sendNotificationEmailIfAllowed(
      prisma,
      "user-1",
      "user@example.com",
      teamItem,
      emailEnabledPrefs
    );

    expect(sent).toBe(true);
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("skips send when email channel is disabled", async () => {
    const { sendTransactionalEmail } = await import("./email.js");
    const sendMock = vi.mocked(sendTransactionalEmail);
    sendMock.mockClear();

    const prisma = {
      notificationEmailLog: {
        createMany: vi.fn(async () => ({ count: 1 })),
        delete: vi.fn(),
      },
    } as unknown as Parameters<typeof sendNotificationEmailIfAllowed>[0];

    const sent = await sendNotificationEmailIfAllowed(
      prisma,
      "user-1",
      "user@example.com",
      teamItem,
      {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        channels: { inapp: true, email: false },
      }
    );

    expect(sent).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("skips send when dedupe row already exists", async () => {
    const { sendTransactionalEmail } = await import("./email.js");
    const sendMock = vi.mocked(sendTransactionalEmail);
    sendMock.mockClear();

    const prisma = {
      notificationEmailLog: {
        createMany: vi.fn(async () => ({ count: 0 })),
        delete: vi.fn(),
      },
    } as unknown as Parameters<typeof sendNotificationEmailIfAllowed>[0];

    const sent = await sendNotificationEmailIfAllowed(
      prisma,
      "user-1",
      "user@example.com",
      teamItem,
      emailEnabledPrefs
    );

    expect(sent).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("releases dedupe claim when send fails", async () => {
    const { sendTransactionalEmail } = await import("./email.js");
    vi.mocked(sendTransactionalEmail).mockResolvedValueOnce({
      sent: false,
      devLogged: false,
    });

    const deleteMock = vi.fn(async () => ({}));
    const prisma = {
      notificationEmailLog: {
        createMany: vi.fn(async () => ({ count: 1 })),
        delete: deleteMock,
      },
    } as unknown as Parameters<typeof sendNotificationEmailIfAllowed>[0];

    const sent = await sendNotificationEmailIfAllowed(
      prisma,
      "user-1",
      "user@example.com",
      teamItem,
      emailEnabledPrefs
    );

    expect(sent).toBe(false);
    expect(deleteMock).toHaveBeenCalledWith({
      where: {
        user_id_notification_key: {
          user_id: "user-1",
          notification_key: teamItem.id,
        },
      },
    });
  });
});

describe("sendOrganizationInviteEmail", () => {
  it("claims NotificationEmailLog per invite token for registered invitees", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      user: {
        findUnique: vi.fn(async () => ({
          id: "user-1",
          email: "invitee@example.com",
          notification_preferences: emailEnabledPrefs,
        })),
      },
      organizationInvite: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      notificationEmailLog: {
        createMany,
        delete: vi.fn(),
      },
    } as unknown as Parameters<typeof sendOrganizationInviteEmail>[0];

    await sendOrganizationInviteEmail(
      prisma,
      { id: "invite-1", email: "invitee@example.com", token: "tok-new" },
      "https://app.example.com/register?invite=tok-new"
    );

    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            user_id: "user-1",
            notification_key: "team:invite:invite-1:tok-new",
          }),
        ]),
      })
    );
  });

  it("skips guest invite email when this token was already sent", async () => {
    const { sendTransactionalEmail } = await import("./email.js");
    const sendMock = vi.mocked(sendTransactionalEmail);
    sendMock.mockClear();

    const prisma = {
      user: {
        findUnique: vi.fn(async () => null),
      },
      organizationInvite: {
        findUnique: vi.fn(async () => ({ invite_email_sent_token: "tok" })),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
      notificationEmailLog: {
        createMany: vi.fn(),
        delete: vi.fn(),
      },
    } as unknown as Parameters<typeof sendOrganizationInviteEmail>[0];

    await sendOrganizationInviteEmail(
      prisma,
      { id: "invite-1", email: "new@example.com", token: "tok" },
      "https://app.example.com/register?invite=tok"
    );

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends guest invite email when re-invited with a new token", async () => {
    const { sendTransactionalEmail } = await import("./email.js");
    const sendMock = vi.mocked(sendTransactionalEmail);
    sendMock.mockClear();

    const prisma = {
      user: {
        findUnique: vi.fn(async () => null),
      },
      organizationInvite: {
        findUnique: vi.fn(async () => ({ invite_email_sent_token: "old-tok" })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(),
      },
      notificationEmailLog: {
        createMany: vi.fn(),
        delete: vi.fn(),
      },
    } as unknown as Parameters<typeof sendOrganizationInviteEmail>[0];

    await sendOrganizationInviteEmail(
      prisma,
      { id: "invite-1", email: "new@example.com", token: "new-tok" },
      "https://app.example.com/register?invite=new-tok"
    );

    expect(sendMock).toHaveBeenCalled();
  });
});
