import { afterEach, describe, expect, it } from "vitest";
import { rateLimitMaxStripeWebhook } from "./rate-limit-env.js";

describe("rateLimitMaxStripeWebhook", () => {
  const prev = process.env.RATE_LIMIT_STRIPE_WEBHOOK_MAX;

  afterEach(() => {
    if (prev === undefined) delete process.env.RATE_LIMIT_STRIPE_WEBHOOK_MAX;
    else process.env.RATE_LIMIT_STRIPE_WEBHOOK_MAX = prev;
  });

  it("uses a high ceiling in tests", () => {
    expect(rateLimitMaxStripeWebhook(true)).toBe(100_000);
  });

  it("defaults to 120 outside tests", () => {
    delete process.env.RATE_LIMIT_STRIPE_WEBHOOK_MAX;
    expect(rateLimitMaxStripeWebhook(false)).toBe(120);
  });

  it("honors RATE_LIMIT_STRIPE_WEBHOOK_MAX", () => {
    process.env.RATE_LIMIT_STRIPE_WEBHOOK_MAX = "45";
    expect(rateLimitMaxStripeWebhook(false)).toBe(45);
  });
});
