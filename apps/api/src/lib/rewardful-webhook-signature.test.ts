import { describe, it, expect } from "vitest";
import { verifyRewardfulSignature } from "./rewardful-webhook-signature.js";
import crypto from "node:crypto";

describe("verifyRewardfulSignature", () => {
  it("returns true for valid signature", () => {
    const secret = "test_secret";
    const payload = JSON.stringify({ id: "evt_123", type: "test" });
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    expect(verifyRewardfulSignature(payload, signature, secret)).toBe(true);
  });

  it("returns false for invalid signature", () => {
    const secret = "test_secret";
    const payload = JSON.stringify({ id: "evt_123", type: "test" });
    const wrongSignature = "invalid_signature";

    expect(verifyRewardfulSignature(payload, wrongSignature, secret)).toBe(false);
  });

  it("returns false for signature with wrong secret", () => {
    const secret = "test_secret";
    const wrongSecret = "wrong_secret";
    const payload = JSON.stringify({ id: "evt_123", type: "test" });
    const signature = crypto.createHmac("sha256", wrongSecret).update(payload).digest("hex");

    expect(verifyRewardfulSignature(payload, signature, secret)).toBe(false);
  });

  it("returns false for empty signature", () => {
    expect(verifyRewardfulSignature("payload", "", "secret")).toBe(false);
  });

  it("returns false for empty secret", () => {
    expect(verifyRewardfulSignature("payload", "sig", "")).toBe(false);
  });

  it("handles Buffer payload", () => {
    const secret = "test_secret";
    const payload = Buffer.from(JSON.stringify({ id: "evt_123" }));
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    expect(verifyRewardfulSignature(payload, signature, secret)).toBe(true);
  });
});
