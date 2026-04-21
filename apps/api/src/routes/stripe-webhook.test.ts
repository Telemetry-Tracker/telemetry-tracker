import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const constructEventMock = vi.fn();
const updateManyMock = vi.fn();

vi.mock("stripe", () => {
  class StripeMock {
    webhooks = { constructEvent: constructEventMock };
  }
  return { default: StripeMock };
});

vi.mock("../lib/db.js", () => ({
  prisma: {
    organization: {
      updateMany: updateManyMock,
    },
  },
}));

import { registerStripeWebhookIfConfigured } from "./stripe-webhook.js";

describe("Stripe webhook conflict handling", () => {
  let app: FastifyInstance;
  let prevSecretKey: string | undefined;
  let prevWebhookSecret: string | undefined;

  beforeEach(async () => {
    prevSecretKey = process.env.STRIPE_SECRET_KEY;
    prevWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    constructEventMock.mockReset();
    updateManyMock.mockReset();
    app = Fastify({ logger: false });
    await registerStripeWebhookIfConfigured(app);
  });

  afterEach(async () => {
    await app.close();
    if (prevSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prevSecretKey;
    if (prevWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prevWebhookSecret;
  });

  it("does not apply plan tier when stripe ids violate uniqueness", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_checkout_completed",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { organization_id: "org-1", plan_tier: "PRO" },
          customer: "cus_1",
          subscription: "sub_1",
        },
      },
    });
    updateManyMock.mockRejectedValueOnce({ code: "P2002" });

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "sig_test",
      },
      payload: "{}",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ received: true });
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "org-1", deleted_at: null },
      data: {
        plan_tier: "PRO",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
      },
    });
  });
});
