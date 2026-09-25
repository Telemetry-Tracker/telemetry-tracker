import { describe, expect, it, vi } from "vitest";
import { alertEventHref, fireProjectAlert, recentAlertNotifications } from "./alert-dispatch.js";

vi.mock("./notification-email-dispatch.js", () => ({
  notifyProjectMembersByEmail: vi.fn(async () => undefined),
}));

vi.mock("./alert-webhook-dispatch.js", () => ({
  enqueueAlertWebhookDeliveries: vi.fn(async () => 1),
}));

import { enqueueAlertWebhookDeliveries } from "./alert-webhook-dispatch.js";
import { notifyProjectMembersByEmail } from "./notification-email-dispatch.js";

describe("alertEventHref", () => {
  it("uses stored href when present", () => {
    expect(alertEventHref("ERROR_SPIKE", "/dashboard/errors/eg-1")).toBe(
      "/dashboard/errors/eg-1"
    );
  });

  it("falls back by rule for legacy rows without href", () => {
    expect(alertEventHref("ERROR_SPIKE", null)).toBe("/dashboard/errors");
    expect(alertEventHref("ALERT_RULE", null)).toBe("/dashboard/errors");
    expect(alertEventHref("QUOTA_NEAR", null)).toBe("/dashboard/settings/billing");
    expect(alertEventHref("QUOTA_EXCEEDED", null)).toBe("/dashboard/settings/billing");
  });
});

describe("fireProjectAlert", () => {
  it("commits AlertEvent and webhook enqueue in one transaction", async () => {
    const create = vi.fn(async () => ({ id: "ae1" }));
    const enqueue = vi.mocked(enqueueAlertWebhookDeliveries);
    enqueue.mockClear();
    enqueue.mockResolvedValue(1);
    vi.mocked(notifyProjectMembersByEmail).mockClear();

    const tx = { alertEvent: { create } };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const ok = await fireProjectAlert(prisma as never, {
      projectId: "p1",
      rule: "ERROR_SPIKE",
      dedupeKey: "alert:error_spike:p1:15:1",
      title: "Spike",
      body: "Many errors",
      href: "/dashboard/errors",
    });

    expect(ok).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        projectId: "p1",
        dedupeKey: "alert:error_spike:p1:15:1",
      })
    );
    expect(notifyProjectMembersByEmail).toHaveBeenCalled();
  });

  it("does not return until notification email work finishes", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let emailStarted = false;
    vi.mocked(notifyProjectMembersByEmail).mockImplementation(async () => {
      emailStarted = true;
      await gate;
    });
    const prisma = {
      $transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) =>
        fn({ alertEvent: { create: async () => ({ id: "ae1" }) } })
      ),
    };

    let settled = false;
    const pending = fireProjectAlert(prisma as never, {
      projectId: "p1",
      rule: "ALERT_RULE",
      dedupeKey: "alert:rule:r1:1",
      title: "Silence",
      body: "No events.",
      href: "/dashboard/overview?range=24h",
    }).then(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(emailStarted).toBe(true);
    });
    expect(settled).toBe(false);
    release();
    await pending;
    expect(settled).toBe(true);
    vi.mocked(notifyProjectMembersByEmail).mockResolvedValue(undefined);
  });

  it("honors destination filters for email and webhooks", async () => {
    const create = vi.fn(async () => ({ id: "ae1" }));
    const enqueue = vi.mocked(enqueueAlertWebhookDeliveries);
    enqueue.mockClear();
    enqueue.mockResolvedValue(0);
    vi.mocked(notifyProjectMembersByEmail).mockClear();

    const tx = { alertEvent: { create } };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const ok = await fireProjectAlert(prisma as never, {
      projectId: "p1",
      rule: "ALERT_RULE",
      dedupeKey: "alert:rule:r1:15:1",
      title: "Custom",
      body: "Triggered",
      href: "/dashboard/errors",
      destinations: {
        email: false,
        webhookIds: ["33333333-3333-3333-3333-333333333333"],
      },
    });

    expect(ok).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        webhookIds: ["33333333-3333-3333-3333-333333333333"],
      })
    );
    expect(notifyProjectMembersByEmail).not.toHaveBeenCalled();
  });

  it("keeps AlertEvent and enqueue in the same transaction callback", async () => {
    const create = vi.fn(async () => ({ id: "ae1" }));
    const enqueue = vi.mocked(enqueueAlertWebhookDeliveries);
    enqueue.mockClear();
    enqueue.mockRejectedValue(new Error("createMany failed"));

    const tx = { alertEvent: { create } };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    await expect(
      fireProjectAlert(prisma as never, {
        projectId: "p1",
        rule: "ERROR_SPIKE",
        dedupeKey: "alert:error_spike:p1:15:1",
        title: "Spike",
        body: "Many errors",
        href: "/dashboard/errors",
      })
    ).rejects.toThrow("createMany failed");

    // Real DB $transaction rolls back the AlertEvent insert with enqueue.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("returns false on unique dedupe collision", async () => {
    const prisma = {
      $transaction: vi.fn(async () => {
        const err = Object.assign(new Error("Unique constraint"), { code: "P2002" });
        throw err;
      }),
    };

    const ok = await fireProjectAlert(prisma as never, {
      projectId: "p1",
      rule: "ERROR_SPIKE",
      dedupeKey: "alert:error_spike:p1:15:1",
      title: "Spike",
      body: "Many errors",
      href: "/dashboard/errors",
    });
    expect(ok).toBe(false);
  });
});

describe("recentAlertNotifications", () => {
  it("includes quota near and exceeded events in the bell feed", async () => {
    const prisma = {
      alertEvent: {
        findMany: async () => [
          {
            rule: "QUOTA_NEAR",
            title: "Usage approaching limit",
            body: "85%",
            href: "/dashboard/settings/billing",
            dedupe_key: "quota:near:p1:2026-07",
            fired_at: new Date("2026-07-01T11:00:00.000Z"),
          },
          {
            rule: "ERROR_SPIKE",
            title: "Error spike detected",
            body: "50 errors",
            href: "/dashboard/errors",
            dedupe_key: "alert:error_spike:p1:15:1",
            fired_at: new Date("2026-07-01T10:00:00.000Z"),
          },
        ],
      },
    } as never;

    const items = await recentAlertNotifications(prisma, "p1");
    expect(items.map((i) => i.type)).toEqual(["alert", "alert"]);
    expect(items.some((i) => i.id.startsWith("quota:near:"))).toBe(true);
    expect(items.some((i) => i.id.startsWith("alert:error_spike:"))).toBe(true);
  });
});
