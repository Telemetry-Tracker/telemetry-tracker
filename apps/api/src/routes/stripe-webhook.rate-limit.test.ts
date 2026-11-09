import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";

vi.mock("../lib/rate-limit-env.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/rate-limit-env.js")>()),
  // Force a tiny Stripe webhook cap while leaving other scopes generous for createApp.
  rateLimitMaxStripeWebhook: () => 3,
  rateLimitMaxPublic: () => 100_000,
  rateLimitMaxAuth: () => 100_000,
  rateLimitMaxApi: () => 100_000,
  rateLimitMaxIngest: () => 100_000,
  rateLimitMaxMcp: () => 100_000,
}));

describe("Stripe webhook rate limit", () => {
  const prevSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const prevKey = process.env.STRIPE_SECRET_KEY;

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prevSecret;
    if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prevKey;
  });

  it("rate-limits unsigned POSTs to /webhooks/stripe by client IP", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_rate_limit";
    process.env.STRIPE_SECRET_KEY = "sk_test_rate_limit";
    const app = await createApp();
    try {
      const inject = () =>
        app.inject({
          method: "POST",
          url: "/webhooks/stripe",
          remoteAddress: "203.0.113.50",
          headers: { "content-type": "application/json" },
          payload: Buffer.from("{}"),
        });

      // Missing/invalid signature → 400, until the IP quota is exhausted → 429.
      expect((await inject()).statusCode).toBe(400);
      expect((await inject()).statusCode).toBe(400);
      expect((await inject()).statusCode).toBe(400);
      expect((await inject()).statusCode).toBe(429);

      // A different client IP is not blocked by the first IP's quota.
      const otherIp = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        remoteAddress: "203.0.113.51",
        headers: { "content-type": "application/json" },
        payload: Buffer.from("{}"),
      });
      expect(otherIp.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
