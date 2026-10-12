import { afterEach, describe, expect, it, vi } from "vitest";
import { submitAffiliateApplication } from "./actions";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));

const input = {
  name: "Ada", email: "ada@example.com", websiteUrl: "https://example.com",
  promotionPlan: "A weekly newsletter for developers.", acceptTerms: true, company_website: "",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("affiliate application IP forwarding", () => {
  it("sends the shared secret and visitor IP from the server action", async () => {
    vi.stubEnv("AFFILIATE_CLIENT_IP_FORWARD_SECRET", "test-forward-secret");
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect((await submitAffiliateApplication(input)).ok).toBe(true);
    const options = fetch.mock.calls[0][1];
    expect(options.headers).toMatchObject({
      "x-tt-client-ip": "203.0.113.7", "x-tt-client-ip-secret": "test-forward-secret",
    });
    expect(options.body).not.toContain("test-forward-secret");
  });

  it("omits forwarding credentials when the secret is unset", async () => {
    vi.stubEnv("AFFILIATE_CLIENT_IP_FORWARD_SECRET", "");
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await submitAffiliateApplication(input);
    expect(fetch.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });
});
