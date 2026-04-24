import { describe, expect, it, vi } from "vitest";
import { PlanTier } from "@prisma/client";
import { applyCheckoutUpgradeUpdate } from "./stripe-webhook.js";

describe("applyCheckoutUpgradeUpdate", () => {
  it("refuses to grant paid tier when subscription id is missing", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const warn = vi.fn();

    await applyCheckoutUpgradeUpdate(
      { updateMany },
      { warn },
      {
        orgId: "org-1",
        tier: PlanTier.PRO,
        customerId: "cus_1",
        subscriptionId: null,
        eventId: "evt_1",
      }
    );

    expect(updateMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toContain("refusing to grant paid tier");
  });

  it("updates plan tier only when subscription id is present", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const warn = vi.fn();

    await applyCheckoutUpgradeUpdate(
      { updateMany },
      { warn },
      {
        orgId: "org-1",
        tier: PlanTier.BUSINESS,
        customerId: "cus_1",
        subscriptionId: "sub_1",
        eventId: "evt_1",
      }
    );

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "org-1", deleted_at: null },
      data: {
        plan_tier: PlanTier.BUSINESS,
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
      },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not throw on unique-constraint conflicts", async () => {
    const p2002 = Object.assign(new Error("unique conflict"), { code: "P2002" });
    const updateMany = vi.fn(async () => {
      throw p2002;
    });
    const warn = vi.fn();

    await expect(
      applyCheckoutUpgradeUpdate(
        { updateMany },
        { warn },
        {
          orgId: "org-1",
          tier: PlanTier.PRO,
          customerId: null,
          subscriptionId: "sub_1",
          eventId: "evt_1",
        }
      )
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toContain("refusing to grant paid tier");
  });

  it("rethrows non-unique database errors", async () => {
    const dbError = Object.assign(new Error("db down"), { code: "P1001" });
    const updateMany = vi.fn(async () => {
      throw dbError;
    });
    const warn = vi.fn();

    await expect(
      applyCheckoutUpgradeUpdate(
        { updateMany },
        { warn },
        {
          orgId: "org-1",
          tier: PlanTier.PRO,
          customerId: null,
          subscriptionId: "sub_1",
          eventId: "evt_1",
        }
      )
    ).rejects.toThrow("db down");

    expect(warn).not.toHaveBeenCalled();
  });
});
